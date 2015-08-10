'use strict';

require('should');

var Pool = require('..');

describe('validNum', function () {
    it('should return the default if opts doesn\'t exist', function () {
        Pool._validNum(void 0, 'foo', 33).should.equal(33);
    });
    it('should return the default if opts has no own property \'val\'', function () {
        Pool._validNum({ }, 'foo', 33).should.equal(33);
        Pool._validNum(Object.create({ foo: 22 }), 'foo', 33).should.equal(33);
    });
    it('should return the specified key if it exists', function () {
        Pool._validNum({ foo: 22 }, 'foo', 33).should.equal(22);
    });
    it('should throw if the value is not a positive integer', function () {
        [1.2, -3, Infinity, new Date(), [ ], { }, 'keke', null, void 0]
        .forEach(function (v) {
            (function () {
                Pool._validNum({ foo: v }, 'foo', 123);
            }).should.throw(/must be a positive integer/);
        });
    });
    it('should throw if the value is 0 unless allowZero is true', function () {
        (function () {
            Pool._validNum({ foo: 0 }, 'foo', 123);
        }).should.throw(/cannot be 0/);
        Pool._validNum({ foo: 0 }, 'foo', 123, true).should.equal(0);
    });
});
describe('Pool', function () {
    var _seq = 0;
    function seqAcquire(cb) { cb(null, { seq: _seq++ }); }
    function disposeStub(res, cb) { cb(); }
    function noop() { }
    
    var pool;
    afterEach(function () { pool._destroyPool(); });

    describe('constructor', function () {
        ['acquire', 'dispose']
        .forEach(function (k) {
            var opts = {
                acquire: 'foo',
                dispose: 'foo'
            };
            delete opts[k];
            it('should throw if '+k+' is not specified', function () {
                (function () {
                    new Pool(opts);
                }).should.throw(new RegExp('opts\.'+k+' is required'));
            });
        });
        
        ['acquire', 'dispose', 'destroy', 'ping']
        .forEach(function (k) {
            var opts = {
                acquire: noop,
                dispose: noop,
                destroy: noop,
                ping: noop
            };
            opts[k] = 'foo';
            it('should throw if '+k+' is not a function', function () {
                (function () {
                    new Pool(opts);
                }).should.throw(new RegExp('opts\.'+k+' must be a function'));
            });
        });
        it('should throw if min is greater than max', function () {
            (function () {
                new Pool({
                    acquire: noop,
                    dispose: noop,
                    min: 3,
                    max: 2
                });
            }).should.throw(/opts\.min cannot be greater than opts\.max/);
        });
        it('should throw if idleTimeout is specified when syncInterval is 0', function () {
            (function () {
                new Pool({
                    acquire: noop,
                    dispose: noop,
                    syncInterval: 0,
                    idleTimeout: 3
                });
            }).should.throw(/Cannot specify opts\.idleTimeout when opts\.syncInterval is 0/);
        });
    });
    
    it('should honor resource limit', function (done) {
        pool = new Pool({
            acquire: seqAcquire,
            dispose: disposeStub,
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
            dispose: disposeStub,
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
            dispose: disposeStub,
            min: 1
        });
        pool.on('error', done.bind(null, null));
    });
    
    it('should emit an error if no initial resource can be acquired (timeout)', function (done) {
        pool = new Pool({
            acquire: function () { },
            acquireTimeout: 10,
            dispose: disposeStub,
            min: 1
        });
        pool.on('error', done.bind(null, null));
    });
    
    it('should retry initial connections until bailAfter is exceeded', function (done) {
        var retries = 0;
        pool = new Pool({
            acquire: function (cb) {
              retries++;
              cb(new Error('fail'));
            },
            dispose: disposeStub,
            bailAfter: 100,
            min: 1
        });
        pool.on('error', function () {
            retries.should.be.above(1);
            done();
        });
    });
    
    it('should pass along backoff options', function (done) {
        var retries = 0;
        pool = new Pool({
            acquire: function (cb) {
              retries++;
              cb(new Error('fail'));
            },
            dispose: disposeStub,
            bailAfter: 100,
            min: 1,
            backoff: {
                min: 150
            }
        });
        pool.on('error', function () {
            // one for the initial attempt
            // one for the attempt that causes the error to be emitted
            retries.should.equal(2);
            done();
        });
    });
    
    it('should allow Infinity for bailAfter', function () {
        pool = new Pool({
            acquire: seqAcquire,
            dispose: disposeStub,
            bailAfter: Infinity
        });
    });
    
    it('should emit an error on releasing an invalid resource', function (done) {
        pool = new Pool({
            acquire: seqAcquire,
            dispose: disposeStub
        });
        pool.on('error', done.bind(null, null));
        pool.release('foo');
    });
    
    it('should emit an error on releasing an idle resource', function (done) {
        pool = new Pool({
            acquire: seqAcquire,
            dispose: disposeStub
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
            dispose: disposeStub
        });
        pool.on('error', done.bind(null, null));
        pool.remove('foo');
    });
    
    it('should allow .remove on an allocated resource', function (done) {
        pool = new Pool({
            acquire: seqAcquire,
            dispose: done.bind(null, null),
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
            dispose: done.bind(null, null),
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
            dispose: disposeStub,
            destroy: done.bind(null, null)
        });
        pool.acquire(function (err, res) {
            pool.destroy(res);
        });
    });
    
    it('should allow .destroy on an idle resource', function (done) {
        pool = new Pool({
            acquire: seqAcquire,
            dispose: disposeStub,
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
            dispose: function () { },
            disposeTimeout: 50,
            destroy: done.bind(null, null)
        });
        pool.acquire(function (err, res) {
            pool.remove(res);
        });
    });
    
    it('should remove idle resources down to the minimum', function (done) {
        pool = new Pool({
            acquire: seqAcquire,
            dispose: disposeStub,
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
            dispose: disposeStub,
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
            dispose: disposeStub,
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
            dispose: disposeStub,
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
            dispose: disposeStub,
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
            dispose: disposeStub,
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
            dispose: disposeStub
        });
        
        pool.end(done);
    });
    
    it('should end gracefully (idle resources)', function (done) {
        pool = new Pool({
            acquire: seqAcquire,
            dispose: function (res, cb) { cb(); },
            min: 1
        });
        setTimeout(function () {
            pool.end(done);
        }, 100);
    });
    
    it('should end gracefully (allocated resources)', function (done) {
        pool = new Pool({
            acquire: seqAcquire,
            dispose: function (res, cb) { cb(); },
            min: 1
        });
        
        pool.acquire(function (err, res) {
            setTimeout(function () {
                pool.release(res);
            }, 100);
        });
        pool.end(done);
    });
    
    it('should end gracefully (resources in allocation)', function (done) {
        pool = new Pool({
            acquire: function (cb) { setTimeout(cb.bind(null, null, { }), 100); },
            dispose: disposeStub
        });
        
        pool.acquire(function (err, res) {
            pool.release(res);
        });
        
        setTimeout(pool.end.bind(pool, done), 50);
    });
    
    it('should end gracefully (min-fill with no pending requests)', function (done) {
        pool = new Pool({
            acquire: function (cb) { setTimeout(cb.bind(null, null, { }), 100); },
            dispose: disposeStub,
            min: 1
        });
        
        setTimeout(pool.end.bind(pool, done), 50);
    });
    
    it('should end gracefully (min-fill with no pending requests, min > 1)', function (done) {
        var dly = 66, num = 0;
        pool = new Pool({
            acquire: function (cb) {
                num++;
                setTimeout(cb.bind(null, null, { }), dly);
                dly += 33;
            },
            dispose: function (res, cb) {
                num--;
                cb();
            },
            min: 2
        });
        
        setTimeout(function () {
            pool.end(function () {
                num.should.equal(0);
                done();
            });
        }, 33);
    });
    
    it('should fail acquire when ending', function (done) {
        pool = new Pool({
            acquire: seqAcquire,
            dispose: function (res, cb) { cb(); },
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
            dispose: function (res, cb) { cb(); },
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
                if (count === 1) { setTimeout(cb.bind(null, null, { val: 'foo' }), 100); }
                else { cb(null, { val: 'bar' }); }
                count++;
            },
            dispose: function (res, cb) {
                try {
                    res.should.eql({ val: 'foo' });
                    done();
                } catch (e) {
                    done(e);
                }
            },
            acquireTimeout: 10,
        });
        
        pool.acquire(function (err, res) { });
        pool.acquire(function (err, res) { });
    });
    
    it('should wait for resources to be released back to the pool before ending', function (done) {
        var released = false;
        pool = new Pool({
            acquire: seqAcquire,
            dispose: function (res, cb) {
                released = true;
                cb();
            }
        });
        var count = 3;
        var doDone = function(err) {
            if (--count) { return; }
            done(err);
        };
        pool.acquire(function (err, res1) {
            pool.acquire(function (err, res2) {
                pool.end(function (err) {
                    released.should.equal(true);
                    doDone(err);
                });
                setTimeout(function () {
                    released.should.equal(false);
                    pool.release(res1);
                    doDone();
                }, 50);
                setTimeout(function () {
                    released.should.equal(false);
                    pool.release(res2);
                    doDone();
                }, 100);
            });
        });
    });

    it('should still support release', function(done) {
        var called = false;
        pool = new Pool({
            acquire: function (cb) { cb(null, 'bar'); },
            release: function (res, cb) { called = true; cb(); },
            min: 1
        });
        
        setTimeout(function () {
            pool.end(function (err, res) {
                (!err).should.be.ok;
                called.should.equal(true);
                done();
            });
        }, 50);
    });
    
    it('should allow disabling of syncInterval', function () {
        pool = new Pool({
            acquire: seqAcquire,
            dispose: disposeStub,
            syncInterval: 0
        });
        // this is usually testing bad behavior, but in this case it's the only simple way to get the job done
        pool.should.not.have.property('syncTimer');
    });
    
    it('should fallback to destroy if disposeTimeout > 1', function (done) {
        pool = new Pool({
            acquire: seqAcquire,
            dispose: function (res, cb) {
                // time out
            },
            destroy: function (res) {
                done();
            },
            disposeTimeout: 1
        });
        pool.acquire(function (err, res) {
            pool.remove(res);
        });
    });
    
    it('should not fallback to destroy if disposeTimeout = 0', function (done) {
        var d = Pool.defaults.disposeTimeout,
            destroyed = false;
        
        before(function () {
            Pool.defaults.disposeTimeout = 1;
        });
        after(function () {
            Pool.defaults.disposeTimeout = d;
        });
        
        pool = new Pool({
            acquire: seqAcquire,
            dispose: function () {
                // time out
            },
            destroy: function () {
                destroyed = true;
            },
            disposeTimeout: 0
        });
        pool.acquire(function (err, res) {
            pool.remove(res);
            
            setTimeout(function () {
                destroyed.should.equal(false);
                done();
            }, 50);
        });
    });
    
    it('should emit an error if a resource cannot be acquired within acquireTimeout ms', function (done) {
        pool = new Pool({
            acquire: function () {
                // time out
            },
            dispose: function () {
            },
            acquireTimeout: 1
        });
        pool.once('error', function (err) {
            err.message.should.match(/Timed out acquiring resource/);
            done();
        });
        pool.acquire(function () { });
    });
    
    it('should not time out resource acquisition if acquireTimeout = 0', function (done) {
        var a = Pool.defaults.acquireTimeout,
            timedOut = false;
        
        before(function () {
            Pool.defaults.acquireTimeout = 1;
        });
        after(function () {
            Pool.defaults.acquireTimeout = a;
        });
        
        pool = new Pool({
            acquire: function () {
                // time out
            },
            dispose: function () {
            },
            acquireTimeout: 0
        });
        pool.once('error', function (err) {
            if (/Timed out acquiring resource/.test(err.message)) { timedOut = true; }
            else { throw err; }
        });
        pool.acquire(function () { });
        
        setTimeout(function () {
            timedOut.should.equal(false);
            done();
        }, 50);
    });
    
    it('should reject pending resource requests when the pool is destroyed', function (done) {
        pool = new Pool({
            acquire: function () { },
            dispose: function () { },
            acquireTimeout: 0
        });
        
        pool.acquire(function (err) {
            err.should.match(/Pool was destroyed/);
            done();
        });
        setTimeout(function () {
            pool._destroyPool();
        }, 50);
    });
    
    it('should not overallocate resources while waiting on a ping (#10)', function (done) {
        var acquires = 0;
        pool = new Pool({
            acquire: function (cb) {
                acquires++;
                setTimeout(seqAcquire.bind(null, cb), 50);
            },
            dispose: disposeStub,
            min: 1
        });
        pool.acquire(function (err, res) {
            acquires.should.equal(1);
            done();
        });
    });
    
    it('should not call back the allocation request if a ping times out (#14)', function (done) {
        var pinged = false, acquires = 0;
        pool = new Pool({
            acquire: function (cb) {
                acquires++;
                seqAcquire(cb);
            },
            pingTimeout: 20,
            ping: function (res, cb) {
                if (pinged) {
                    // we've already timed out a ping, succeed the rest immediately
                    cb();
                  
                    // also set a timer to finish up the test later
                    setTimeout(function () {
                        acquires.should.equal(2);
                        done();
                    }, 100);
                } else {
                    // force a successful callback after the ping timeout
                    setTimeout(cb, 50);
                }
                pinged = true;
            },
            dispose: disposeStub,
            min: 1
        });
        pool.once('error', done);
        pool.acquire(function (err, res) {
            pool.release(res);
        });
    });
});
