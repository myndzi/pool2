'use strict';

require('should');

var ResourceRequest = require('../lib/resource-request');

describe('ResourceRequest', function () {
    it('should throw without a callback', function () {
        (function () {
            new ResourceRequest();
        }).should.throw(/callback is required/);
    });
    it('should instantiate with a callback', function () {
        (function () {
            new ResourceRequest(function () { });
        }).should.not.throw();
    });
    it('should accept an optional timeout', function () {
        (function () {
            var res = new ResourceRequest(123, function () { });
            res.clearTimeout();
        }).should.not.throw();
    });
    it('should not accept a zero timeout', function () {
        (function () {
            new ResourceRequest(0, function () { });
        }).should.throw(/invalid duration/);
    });
    it('should not accept a negative timeout', function () {
        (function () {
            new ResourceRequest(-123, function () { });
        }).should.throw(/invalid duration/);
    });
    it('should accept an Infinity timeout', function () {
        (function () {
            new ResourceRequest(Infinity, function () { });
        }).should.not.throw();
    });
    it('should time out when given a timeout in the constructor', function (done) {
        var res = new ResourceRequest(10, function (err, res) {
            err.should.match(/timed out/);
            done();
        });
        res.on('error', function (err) {
            err.should.match(/timed out/);
        });
    });
    it('should time out when using setTimeout', function (done) {
        var res = new ResourceRequest(function (err, res) {
            err.should.match(/timed out/);
            done();
        });
        res.on('error', function (err) {
            err.should.match(/timed out/);
        });
        setImmediate(function () {
            res.setTimeout(10);
        });
    });
    it('should time out immediately when using setTimeout with a shorter duration than the elapsed time', function (done) {
        var res = new ResourceRequest(function (err, res) {
            err.should.match(/timed out/);
            done();
        });
        res.on('error', function (err) {
            err.should.match(/timed out/);
        });
        setTimeout(function () {
            res.setTimeout(1);
            (res.timer === null).should.be.ok;
        }, 50);
    });
    it('should clear the timeout if setTimeout is called with Infinity', function () {
        var res = new ResourceRequest(10, function (err, res) {
            err.should.match(/timed out/);
            done();
        });
        res.on('error', function (err) {
            err.should.match(/timed out/);
        });
        res.setTimeout(Infinity);
        (res.timer === null).should.be.ok;
    });
    it('should not time out when the timeout has been cleared', function (done) {
        var res = new ResourceRequest(50, function (err, res) {
            done();
        });
        setImmediate(function () {
            res.clearTimeout();
            setTimeout(done, 100);
        });
    });
    it('should reject and emit when using abort', function (done) {
        var res = new ResourceRequest(function (err) {
            err.should.match(/aborted: No reason given/);
            done();
        });
        res.on('error', function (err) {
            err.should.match(/aborted/);
        });
        setImmediate(function () {
            res.abort();
        });
    });
    it('should pass along an abort message', function (done) {
        var res = new ResourceRequest(function (err) {
            err.should.match(/aborted: foo/);
            done();
        });
        res.on('error', function (err) {
            err.should.match(/aborted/);
        });
        setImmediate(function () {
            res.abort('foo');
        });
    });
    it('should emit an error when being fulfilled twice, but only call the callback once', function (done) {
        var counter = 0;
        var res = new ResourceRequest(function () {
            counter++;
            counter.should.equal(1);
        });
        res.on('error', function (err) {
            err.should.match(/redundant fulfill/);
            done();
        });
        res.resolve(1);
        res.resolve(1);
    });
    it('should emit an error and call back with an error when rejected', function (done) {
        var res = new ResourceRequest(function (err) {
            err.should.match(/bar/);
            done();
        });
        res.on('error', function (err) {
            err.should.match(/bar/);
        });
        res.reject(new Error('bar'));
    });
    it('should not throw synchronously when setting a timeout that has already expired', function (done) {
        var res = new ResourceRequest(1000, function (err) {
            err.should.match(/timed out/);
        });
        setTimeout(function () {
            try {
                res.setTimeout(1);
            } catch (e) {
                done(new Error('Caught synchronous throw from ResourceRequest.setTimeout'));
            }
            res.on('error', function () {
                done();
            });
        }, 25);
    });
});