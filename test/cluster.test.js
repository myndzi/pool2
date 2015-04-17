'use strict';

require('should');

var Pool = require('..'),
    Cluster = Pool.Cluster;

describe('Cluster', function () {
    var _seq = 0;
    function acquireFn(tag) {
        return function seqAcquire(cb) { cb(null, { seq: _seq++, tag: tag }); }
    }
    function noop(cb) { cb(); }
    
    var cluster;
    afterEach(function () { cluster.end(); });
    
    it('Should instantiate with no arguments', function () {
        cluster = new Cluster();
    });
    it('Should emit an error when no callback is given', function () {
        cluster = new Cluster();
        cluster.acquire.bind(cluster).should.throw(/Callback is required/);
    });
    it('Should call back with an error when no pools are available', function (done) {
        cluster = new Cluster();
        cluster.acquire(function (err) {
            err.should.match(/No pools available/);
            done();
        });
    });
    it('Should throw with non-Pool arguments (singular)', function () {
        (function () {
            cluster = new Cluster('foo');
        }).should.throw(/Not a valid pool/);
    });
    it('Should emit an error with non-Pool arguments (array)', function () {
        (function () {
            cluster = new Cluster(['foo', 'bar']);
        }).should.throw(/Not a valid pool/);
    });
    it('Should instantiate with a singular argument', function (done) {
        var pool1 = new Pool({
            acquire: acquireFn('pool1'),
            dispose: noop
        });

        cluster = new Cluster(pool1);
        cluster.acquire(done);
    });
    it('Should instantiate with an array', function (done) {
        var pool1 = new Pool({
            acquire: acquireFn('pool1'),
            dispose: noop
        }), pool2 = new Pool({
            acquire: acquireFn('pool2'),
            dispose: noop
        });
        cluster = new Cluster([pool1, pool2]);
        
        cluster.acquire(done);
    });
    it('Should error on releasing an invalid resource', function (done) {
        var pool1 = new Pool({
            acquire: acquireFn('pool1'),
            dispose: noop
        });
        cluster = new Cluster(pool1);
        cluster.on('error', done.bind(null, null));
        cluster.release('foo');
    });
    it('Should return from the pool with the most available / fewest queued requests', function (done) {
        var pool1 = new Pool({
            acquire: acquireFn('pool1'),
            dispose: noop
        }), pool2 = new Pool({
            acquire: acquireFn('pool2'),
            dispose: noop
        });
        cluster = new Cluster([pool1, pool2]);
        
        cluster.acquire(function (err, res1) {
            var tag = res1.tag;
            
            cluster.acquire(function (err, res2) {
                res2.tag.should.not.equal(res1.tag);
                
                cluster.release(res1);
                cluster.release(res2);
                
                done();
            });
        });
    });
    it('Should error when requested capability is unavailable', function (done) {
        var pool1 = new Pool({
            acquire: acquireFn('pool1'),
            dispose: noop,
            capabilities: ['read']
        });
        cluster = new Cluster(pool1);
        
        cluster.acquire('write', function (err) {
            err.should.match(/No pools can fulfil capability/);
            done();
        });
    });
    it('Should return only pools that match requested capabilities (subset)', function (done) {
        var pool1 = new Pool({
            acquire: acquireFn('pool1'),
            dispose: noop,
            capabilities: ['read']
        }), pool2 = new Pool({
            acquire: acquireFn('pool2'),
            dispose: noop,
            capabilities: ['read', 'write']
        });
        cluster = new Cluster([pool1, pool2]);
        
        cluster.acquire('write', function (err, res1) {
            var tag = res1.tag;
            
            cluster.acquire('write', function (err, res2) {
                res2.tag.should.equal(res1.tag);
                
                cluster.release(res1);
                cluster.release(res2);
                
                done();
            });
        });
    });
    it('Should return only pools that match requested capabilities (superset)', function (done) {
        var pool1 = new Pool({
            acquire: acquireFn('pool1'),
            dispose: noop,
            capabilities: ['read']
        }), pool2 = new Pool({
            acquire: acquireFn('pool2'),
            dispose: noop,
            capabilities: ['read', 'write']
        });
        cluster = new Cluster([pool1, pool2]);
        
        cluster.acquire('read', function (err, res1) {
            var tag = res1.tag;
            
            cluster.acquire('read', function (err, res2) {
                res2.tag.should.not.equal(res1.tag);
                
                cluster.release(res1);
                cluster.release(res2);
                
                done();
            });
        });
    });
    it('Should error if all pools are full', function (done) {
        var pool1 = new Pool({
            acquire: acquireFn('pool1'),
            dispose: noop,
            max: 1
        }), pool2 = new Pool({
            acquire: acquireFn('pool2'),
            dispose: noop,
            max: 1
        });
        cluster.acquire(function () { });
        cluster.acquire(function () { });
        cluster.acquire(function (err) {
            err.should.match(/No pools available/);
            done();
        });
    });
    it('Should wait and end cleanly', function (done) {
        var pool1 = new Pool({
            acquire: acquireFn('pool1'),
            dispose: noop
        }), pool2 = new Pool({
            acquire: acquireFn('pool2'),
            dispose: noop
        });
        cluster = new Cluster([pool1, pool2]);
        
        cluster.acquire(function (err, res) {
            setTimeout(function () { cluster.release(res); }, 100);
        });
        cluster.end(done.bind(null, null));
    });
    it('Should error on acquire when ended', function (done) {
        var pool1 = new Pool({
            acquire: acquireFn('pool1'),
            dispose: noop
        });
        cluster = new Cluster(pool1);
        
        cluster.acquire('write', function (err) {
            err.should.match(/Cluster is ended/);
            done();
        });
    });
});
