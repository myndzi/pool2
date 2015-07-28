'use strict';

var inherits = require('util').inherits,
    EventEmitter = require('events').EventEmitter;

var _id = 0;

// this has promisey semantics but can't really be replaced with a simple promise
function ResourceRequest(callback) {
    EventEmitter.call(this);
    
    this.id = _id++;
    this.ts = new Date();
    this.cb = callback;
    this.fulfilled = false;
}
inherits(ResourceRequest, EventEmitter);

ResourceRequest.prototype.resolve = function (res) {
    if (this.fulfilled) {
        this.emit('error', new Error('ResourceRequest.resolve(): Already fulfilled'));
    } else {
        this.fulfilled = true;
        this.cb(null, res);
    }
};
ResourceRequest.prototype.reject = function (err) {
    if (this.fulfilled) {
        this.emit('error', err);
    } else {
        this.fulfilled = true;
        this.cb(err);
    }
};
ResourceRequest.prototype.abort = function () {
    this.fulfilled = true;
};

module.exports = ResourceRequest;
