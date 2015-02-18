# Pool2

A generic resource pool

## Usage

    var Pool = require('pool2');
    var pool = new Pool({
        acquire: function (cb) { cb(null, resource); },
        acquireTimeout: 30*1000,

        release: function (res, cb) { cb(); },
        releaseTimeout: 30*1000,

        destroy: function () { },

        ping: function (res, cb) { cb(); },
        pingTimeout: 10*1000,

        capabilities: ['tags'],

        min: 0,
        max: 10,

        idleTimeout: 60*1000,
        syncInterval: 10*1000
    });

    pool.acquire(function (err, rsrc) {
        // do stuff
        pool.release(rsrc);
    });

    pool.stats();
    /* {
        min: 0,
        max: 10,
        allocated: 0,
        available: 0,
        queued: 0
    } */

    pool.remove(rsrc);
    pool.destroy(rsrc);

    pool.end(function (errs) {
        // errs is null or an array of errors from resources that were released
    });

    pool._destroyPool();

