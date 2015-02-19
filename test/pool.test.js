'use strict';

require('should');

var Pool = require('..');

describe('Pool', function () {
    var _seq = 0;
    function seqAcquire(cb) { cb(null, _seq++); }
    function noop() { }

    var pool;
    afterEach(function () { pool._destroyPool(); });
    
    it('should honor resource limit', function (done) {
        pool = new Pool({
            acquire: seqAcquire,
            release: noop,
            max: 1
        });
        
        var waited = false;
        pool.acquire(function (err, res) {
            pool.acquire(function (err, res) {
                pool.release(res);
                waited.should.equal(true);
                done();
            });
            setTimeout(function () {
                waited = true;
                pool.release(res);
            }, 100);
        });
    });
    
    it('should allocate the minimum number of resources', function (done) {
        pool = new Pool({
            acquire: seqAcquire,
            release: noop,
            min: 1
        });
        setTimeout(function () {
            pool.stats().allocated.should.equal(1);
            done();
        }, 100);
    });
    
    it('should emit an error if no initial resource can be acquired', function (done) {
        pool = new Pool({
            acquire: function (cb) { cb(new Error('fail')); },
            release: noop,
            min: 1
        });
        pool.on('error', done.bind(null, null));
    });
    
    it('should emit an error if no initial resource can be acquired (timeout)', function (done) {
        pool = new Pool({
            acquire: function () { },
            acquireTimeout: 10,
            release: noop,
            min: 1
        });
        pool.on('error', done.bind(null, null));
    });
    
    it('should emit an error on releasing an invalid resource', function (done) {
        pool = new Pool({
            acquire: seqAcquire,
            release: noop
        });
        pool.on('error', done.bind(null, null));
        pool.release('foo');
    });
    
    it('should emit an error on releasing an idle resource', function (done) {
        pool = new Pool({
            acquire: seqAcquire,
            release: noop
        });
        pool.on('error', done.bind(null, null));
        pool.acquire(function (err, res) {
            pool.release(res);
            pool.release(res);
        });
    });
    
    it('should emit an error on removing a non-member', function (done) {
        pool = new Pool({
            acquire: seqAcquire,
            release: noop
        });
        pool.on('error', done.bind(null, null));
        pool.remove('foo');
    });
    
    it('should allow .remove on an allocated resource', function (done) {
        pool = new Pool({
            acquire: seqAcquire,
            release: done.bind(null, null),
            min: 1,
            max: 1
        });
        pool.acquire(function (err, res) {
            pool.remove(res);
            pool.stats().allocated.should.equal(0);
        });
    });
    
    it('should allow .remove on an idle resource', function (done) {
        pool = new Pool({
            acquire: seqAcquire,
            release: done.bind(null, null),
            min: 1,
            max: 1
        });
        
        pool.acquire(function (err, res) {
            pool.release(res);
            pool.remove(res);
            pool.stats().allocated.should.equal(0);
        });
    });
    
    it('should allow .destroy on an allocated resource', function (done) {
        pool = new Pool({
            acquire: seqAcquire,
            release: noop,
            destroy: done.bind(null, null)
        });
        pool.acquire(function (err, res) {
            pool.destroy(res);
        });
    });
    
    it('should allow .destroy on an idle resource', function (done) {
        pool = new Pool({
            acquire: seqAcquire,
            release: noop,
            destroy: done.bind(null, null)
        });
        
        pool.acquire(function (err, res) {
            pool.release(res);
            pool.destroy(res);
        });
    });
    
    it('should call .destroy if .remove times out', function (done) {
        pool = new Pool({
            acquire: seqAcquire,
            release: noop,
            releaseTimeout: 50,
            destroy: done.bind(null, null)
        });
        pool.acquire(function (err, res) {
            pool.remove(res);
        });
    });
    
    it('should remove idle resources down to the minimum', function (done) {
        pool = new Pool({
            acquire: seqAcquire,
            release: noop,
            syncInterval: 10,
            idleTimeout: 10,
            min: 1
        });
        pool.acquire(function (err, res) {
            pool.acquire(function (err, res2) {
                pool.release(res);
                pool.release(res2);
                setTimeout(function () {
                    pool.stats().allocated.should.equal(1);
                    done();
                }, 100);
            });
        });
    });
    
    it('should refill resources up to the minimum', function (done) {
        pool = new Pool({
            acquire: seqAcquire,
            release: noop,
            syncInterval: 10,
            idleTimeout: 10,
            min: 1
        });
        pool.acquire(function (err, res) {
            pool.remove(res);
            
            setTimeout(function () {
                pool.stats().allocated.should.equal(1);
                done();
            }, 100);
        });
    });
    
    it('should ping resources before use', function (done) {
        var pings = 0;
        pool = new Pool({
            acquire: seqAcquire,
            release: noop,
            ping: function (res, cb) { pings++; cb(); },
            min: 1,
            max: 1
        });
        pool.acquire(function (err, res) {
            pings.should.equal(1);
            pool.release(res);
            done();
        });
    });
    
    it('should execute requests in order', function (done) {
        var count = 0;
        pool = new Pool({
            acquire: seqAcquire,
            release: noop,
            min: 1,
            max: 1
        });
        pool.acquire(function (err, res) {
            count.should.equal(0);
            count++;
            pool.release(res);
        });
        pool.acquire(function (err, res) {
            count.should.equal(1);
            count++;
            pool.release(res);
            done();
        });
    });

    it('should acquire a new resource if ping fails', function (done) {
        var pings = 0, num;
        pool = new Pool({
            acquire: seqAcquire,
            release: noop,
            ping: function (res, cb) {
                pings++;
                if (pings === 3) { cb(new Error('foo')); }
                else { cb(); }
            },
            min: 1,
            max: 1
        });
        pool.acquire(function (err, res) {
            num = res;
            pool.release(res);
        });
        pool.acquire(function (err, res) {
            num.should.equal(res);
            pool.release(res);
        });
        pool.acquire(function (err, res) {
            num.should.not.equal(res);
            pool.release(res);
            done();
        });
    });
    
    it('should fail acquire when pool is full', function (done) {
        pool = new Pool({
            acquire: seqAcquire,
            release: noop,
            min: 1,
            max: 1,
            maxRequests: 1
        });
        pool.acquire(function (err, res) {
            pool.acquire(function (err, res2) {
                pool.release(res2);
            });
            pool.acquire(function (err) {
                err.message.should.match(/Pool is full/);
                pool.release(res);
                done();
            });
        });
    });
    
    it('should end gracefully (no resources)', function (done) {
        pool = new Pool({
            acquire: seqAcquire,
            release: noop
        });
        
        pool.end(done);
    });
    
    it('should end gracefully (idle resources)', function (done) {
        pool = new Pool({
            acquire: seqAcquire,
            release: function (res, cb) { cb(); },
            min: 1
        });
        setTimeout(function () {
            pool.end(done);
        }, 100);
    });
    
    it('should end gracefully (allocated resources)', function (done) {
        pool = new Pool({
            acquire: seqAcquire,
            release: function (res, cb) { cb(); },
            min: 1
        });
        
        pool.acquire(function (err, res) {
            setTimeout(function () {
                pool.release(res);
            }, 100);
        });
        pool.end(done);
    });
    
    it('should fail acquire when ending', function (done) {
        pool = new Pool({
            acquire: seqAcquire,
            release: function (res, cb) { cb(); },
            min: 1
        });
        
        pool.end();
        pool.acquire(function (err, res) {
            err.message.should.match(/ending/);
            done();
        });
    });
    
    it('should fail acquire when destroyed', function (done) {
        pool = new Pool({
            acquire: seqAcquire,
            release: function (res, cb) { cb(); },
            min: 1
        });
        
        pool._destroyPool();
        pool.acquire(function (err, res) {
            err.message.should.match(/destroyed/);
            done();
        });
    });
    
    it('should attempt to nicely release resources that arrived late', function (done) {
        var count = 0;
        pool = new Pool({
            acquire: function (cb) {
                if (count === 1) { setTimeout(cb.bind(null, null, 'foo'), 100); }
                else { cb(null, 'bar'); }
                count++;
            },
            release: function () { },
            acquireTimeout: 10,
        });
        pool._release = function (res, cb) {
            res.should.equal('foo');
            done();
        };
        pool.acquire(function (err, res) { });
        pool.acquire(function (err, res) { });
    });
    
});
