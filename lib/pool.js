'use strict';

var Deque = require('double-ended-queue'),
    HashMap = require('hashmap');

var inherits = require('util').inherits,
    EventEmitter = require('events').EventEmitter;

//Pool.debug = true;
function debug() {
    if (!Pool.debug) { return; }
    console.log.apply(console, arguments);
}

function Pool(opts) { // jshint ignore: line
    EventEmitter.call(this);
    
    opts = opts || { };

    if (typeof opts.acquire !== 'function') {
        throw new Error('new Pool(): acquire function is required');
    }
    if (typeof opts.release !== 'function') {
        throw new Error('new Pool(): release function is required');
    }
    if (opts.destroy && typeof opts.destroy !== 'function') {
        throw new Error('new Pool(): destroy must be a function');
    }
    if (opts.ping && typeof opts.ping !== 'function') {
        throw new Error('new Pool(): ping must be a function');
    }
    
    this._acquire = opts.acquire;
    this._release = opts.release;
    this._destroy = opts.destroy || function () { };
    this._ping = opts.ping || function (res, cb) { cb(); };
    
    opts.min = parseInt(opts.min, 10);
    opts.max = parseInt(opts.max, 10);
    
    this.max = !isNaN(opts.max) && opts.max >= 1 ? opts.max : 10;
    this.min = !isNaN(opts.min) && opts.min >= 0 && opts.min <= this.max ? opts.min : 0;
    
    opts.maxRequests = parseInt(opts.maxRequests, 10);
    this.maxRequests = !isNaN(opts.maxRequests) && opts.maxRequests >= 1 ? opts.maxRequests : Infinity;
    
    opts.acquireTimeout = parseInt(opts.acquireTimeout, 10);
    opts.releaseTimeout = parseInt(opts.releaseTimeout, 10);
    opts.pingTimeout = parseInt(opts.pingTimeout, 10);
    opts.idleTimeout = parseInt(opts.idleTimeout, 10);
    opts.syncInterval = parseInt(opts.syncInterval, 10);
    
    this.acquireTimeout = !isNaN(opts.acquireTimeout) ? opts.acquireTimeout : 30 * 1000;
    this.releaseTimeout = !isNaN(opts.releaseTimeout) ? opts.acquireTimeout : 30 * 1000;
    this.pingTimeout = !isNaN(opts.pingTimeout) ? opts.pingTimeout : 10 * 1000;
    this.idleTimeout = !isNaN(opts.idleTimeout) ? opts.idleTimeout : 60 * 1000;
    this.syncInterval = !isNaN(opts.syncInterval) ? opts.syncInterval : 10 * 1000;
    
    this.capabilities = Array.isArray(opts.capabilities) ? opts.capabilities.slice() : [ ];
    
    this.syncTimer = setInterval(function () {
        this._ensureMinimum();
        this._reap();
        this._maybeAllocateResource();
    }.bind(this), this.syncInterval);
    
    this.live = false;
    this.ending = false;
    this.destroyed = false;
    
    this.acquiring = 0;
    
    this.pool = new HashMap();
    this.available = [ ];
    this.requests = new Deque();
    
    process.nextTick(this._ensureMinimum.bind(this));
}
inherits(Pool, EventEmitter);

// return stats on the pool
Pool.prototype.stats = function () {
    var allocated = this.pool.count();
    return {
        min: this.min,
        max: this.max,
        allocated: allocated,
        available: this.max - (allocated - this.available.length),
        queued: this.requests.length,
        maxRequests: this.maxRequests
    };
};

// request a resource from the pool
Pool.prototype.acquire = function (cb) {
    if (this.destroyed || this.ending) {
        cb(new Error('Pool is ' + (this.ending ? 'ending' : 'destroyed')));
        return;
    }
    
    if (this.requests.length >= this.maxRequests) {
        cb(new Error('Pool is full'));
        return;
    }
    
    this.requests.push({ ts: new Date(), cb: cb });
    process.nextTick(this._maybeAllocateResource.bind(this));
};

// release the resource back into the pool
Pool.prototype.release = function (res) { // jshint maxstatements: 17
    var err;
    
    if (!this.pool.has(res)) {
        err = new Error('Pool.release(): Resource not member of pool');
        err.res = res;
        this.emit('error', err);
        return;
    }
    
    if (this.available.indexOf(res) > -1) {
        err = new Error('Pool.release(): Resource already released');
        err.res = res;
        this.emit('error', err);
        return;
    }
    
    
    this.pool.set(res, new Date());
    this.available.unshift(res);
    
    if (this.requests.length === 0) { this.emit('drain'); }
    
    this._maybeAllocateResource();
};

// destroy the resource -- should be called only on error conditions and the like
Pool.prototype.destroy = function (res) {
    debug('Ungracefully destroying resource');
    // make sure resource is not in our available resources array
    var idx = this.available.indexOf(res);
    if (idx > -1) { this.available.splice(idx, 1); }

    // remove from pool if present
    if (this.pool.has(res)) {
        this.pool.remove(res);
    }
    
    // destroy is fire-and-forget
    try { this._destroy(res); }
    catch (e) { this.emit('warn', e); }
    
    this._ensureMinimum();
};

// attempt to tear down the resource nicely -- should be called when the resource is still valid
// (that is, the release callback is expected to behave correctly)
Pool.prototype.remove = function (res, cb) {
    // called sometimes internally for the timeout logic, but don't want to emit an error in those cases
    var skipError = false;
    if (typeof cb === 'boolean') {
        skipError = cb;
        cb = null;
    }
    
    // ensure resource is not in our available resources array
    var idx = this.available.indexOf(res);
    if (idx > -1) { this.available.splice(idx, 1); }
    
    if (this.pool.has(res)) {
        this.pool.remove(res);
    } else if (!skipError) {
        // object isn't in our pool -- emit an error
        this.emit('error', new Error('Pool.remove() called on non-member'));
    }
    
    // if we don't get a response from the release callback
    // within the timeout period, attempt to destroy the resource
    var timer = setTimeout(this.destroy.bind(this, res), this.releaseTimeout);
    
    try {
        debug('Attempting to gracefully remove resource');
        this._release(res, function (e) {
            clearTimeout(timer);
            if (e) { this.emit('warn', e); }
            else { this._ensureMinimum(); }
            
            if (typeof cb === 'function') { cb(e); }
        }.bind(this));
    } catch (e) {
        clearTimeout(timer);
        this.emit('warn', e);
        if (typeof cb === 'function') { cb(e); }
    }
};

// attempt to gracefully close the pool
Pool.prototype.end = function (cb) {
    cb = cb || function () { };
    
    this.ending = true;
    
    var closeResources = function () {
        debug('Closing resources');
        clearInterval(this.syncTimer);
        
        var count = this.pool.count(),
            errors = [ ];
        
        if (count === 0) {
            cb();
            return;
        }
        
        this.pool.forEach(function (value, key) {
            this.remove(key, function (err, res) {
                if (err) { errors.push(err); }
                
                count--;
                if (count === 0) {
                    debug('Resources closed');
                    if (errors.length) { cb(errors); }
                    else { cb(); }
                }
            });
        }.bind(this));
    }.bind(this);
    
    // begin now, or wait until there are no pending requests
    if (this.requests.length === 0 && this.acquiring === 0) {
        closeResources();
    } else {
        debug('Waiting for active requests to conclude before closing resources');
        this.once('drain', closeResources);
    }
};

// close idle resources
Pool.prototype._reap = function () {
    var n = this.pool.count(),
        i, c = 0, res, idleTimestamp,
        idleThreshold = (new Date()) - this.idleTimeout;
    
    debug('reap (cur=%d, av=%d)', n, this.available.length);
    
    for (i = this.available.length; n > this.min && i >= 0; i--) {
        res = this.available[i];
        idleTimestamp = this.pool.get(res);
        
        if (idleTimestamp < idleThreshold) {
            n--; c++;
            this.remove(res);
        }
    }
    
    if (c) { debug('Shrinking pool: destroying %d idle connections', c); }
};

// attempt to acquire at least the minimum quantity of resources
Pool.prototype._ensureMinimum = function () {
    if (this.ending || this.destroyed) { return; }
    
    var n = this.min - (this.pool.count() + this.acquiring);
    if (n <= 0) { return; }
    
    debug('Attempting to acquire minimum resources (cur=%d, min=%d)', this.pool.count(), this.min);
    while (n--) { this._allocateResource(); }
};

// allocate a resource to a waiting request, if possible
Pool.prototype._maybeAllocateResource = function () {
    // do nothing if there are no requests to serve
    if (this.requests.length === 0) { return; }
    
    // call callback if there is a request and a resource to give it
    if (this.available.length) {
        var res = this.available.shift();
        
        var abort = function () {
            this.remove(res);
            this._maybeAllocateResource();
        }.bind(this);
        
        var timer = setTimeout(abort, this.pingTimeout);

        try {
            this._ping(res, function (err) {
                clearTimeout(timer);
                if (err) {
                    err.message = 'Ping failed, releasing resource: ' + err.message;
                    this.emit('warn', err);
                    abort();
                    return;
                }
                
                var req = this.requests.shift();
                debug('Allocating resource to request; waited %ds', ((new Date()) - req.ts) / 1000);
                req.cb(null, res);
            }.bind(this));
        } catch (err) {
            err.message = 'Synchronous throw attempting to ping resource: ' + err.message;
            this.emit('error', err);
            abort();
        }
        
        return;
    }
    
    // allocate a new resource if there is a request but no resource to give it
    // and there's room in the pool
    if (this.pool.count() + this.acquiring < this.max) {
        debug('Growing pool: no resource to serve request');
        this._allocateResource();
    }
};

// create a new resource
Pool.prototype._allocateResource = function () {
    if (this.destroyed) {
        debug('Not allocating resource: destroyed');
        return;
    }
    
    debug('Attempting to acquire resource (cur=%d, ac=%d)', this.pool.count(), this.acquiring);
    
    // acquiring is asynchronous, don't over-allocate due to in-progress resource allocation
    this.acquiring++;
    
    var onError, timer;
    
    onError = function (err) {
        clearTimeout(timer);
        
        debug('Couldn\'t allocate new resource:', err);
        
        // throw an error if we haven't successfully allocated a resource yet
        if (this.live === false) {
            this._destroyPool();
            err.message = 'Error allocating resources: ' + err.message;
            this.emit('error', err);
        }
    }.bind(this);
    
    timer = setTimeout(function () {
        debug('Timed out acquiring resource');
        timer = null;
        this.acquiring--;
        
        onError(new Error('Timed out acquiring resource'));
        
        // timed out allocations are dropped; this could leave us below the
        // minimum threshold; try to bring us up to the minimum, but don't spam
        setTimeout(this._ensureMinimum.bind(this), 2 * 1000);
    }.bind(this), this.acquireTimeout);
    
    try {
        this._acquire(function (err, res) { // jshint maxstatements: 20
            if (timer) {
                clearTimeout(timer);
                timer = null;
                this.acquiring--;
            } else if (!err) {
                this.remove(res, true);
                return;
            }
            
            if (err) {
                onError(err);
                return;
            }
            
            this.live = true;
            
            debug('Successfully allocated new resource (cur=%d, ac=%d)', this.pool.count(), this.acquiring);
            
            this.pool.set(res, new Date());
            this.available.unshift(res);
            
            // normally 'drain' is emitted when the pending requests queue is empty; pending requests
            // are the primary source of acquiring new resources. the pool minimum can cause resources
            // to be acquired with no pending requests, however. if pool.end() is called while resources
            // are being acquired to fill the minimum, the 'drain' event will never get triggered because
            // there were no requests pending. in this case, we want to trigger the cleanup routine that
            // normally binds to 'drain'
            if (this.ending && this.requests.length === 0 && this.acquiring === 0) {
                this.emit('drain');
                return;
            }            
            
            // we've successfully acquired a resource, and we only get
            // here if something wants it, so... do that
            this._maybeAllocateResource();
        }.bind(this));
    } catch (e) {
        onError(e);
    }
};

// destroy the pool itself
Pool.prototype._destroyPool = function () {
    this.destroyed = true;
    clearInterval(this.syncTimer);
    this.pool.forEach(function (value, key) {
        this.destroy(key);
    }.bind(this));
    this.pool.clear();
};

module.exports = Pool;
