//@ts-check
/*
  Copyright: (c) 2016-2019, Smart-Tech Controle e Automação
  GNU General Public License v3.0+ (see LICENSE or https://www.gnu.org/licenses/gpl-3.0.txt)
*/

function nrInputShim(node, fn){
    node.on('input', function(msg, send, done){
        send = send || node.send;
        done = done || function(err) { err && node.error(err) }
        fn(msg, send, done);
    });
}

module.exports = function(RED) {
    "use strict";

    var util = require('util');
    var nodepccc = require('nodepccc');
    var EventEmitter = require('events').EventEmitter;

    // ---------- pccc Endpoint ----------

    function createTranslationTable(vars) {
        var res = {};

        vars.forEach(function(elm) {
            res[elm.name] = elm.addr;
        });

        return res;
    }

    function generateStatus(status, val) {
        var obj;

        if (typeof val != 'string' && typeof val != 'number' && typeof val != 'boolean') {
            val = RED._("pccc.endpoint.status.online");
        }

        switch (status) {
            case 'online':
                obj = {
                    fill: 'green',
                    shape: 'dot',
                    text: val.toString()
                };
                break;
            case 'badvalues':
                obj = {
                    fill: 'yellow',
                    shape: 'dot',
                    text: RED._("pccc.endpoint.status.badvalues")
                };
                break;
            case 'offline':
                obj = {
                    fill: 'red',
                    shape: 'dot',
                    text: RED._("pccc.endpoint.status.offline")
                };
                break;
            case 'connecting':
                obj = {
                    fill: 'yellow',
                    shape: 'dot',
                    text: RED._("pccc.endpoint.status.connecting")
                };
                break;
            default:
                obj = {
                    fill: 'grey',
                    shape: 'dot',
                    text: RED._("pccc.endpoint.status.unknown")
                };
        }
        return obj;
    }

    function pcccEndpoint(config) {
        EventEmitter.call(this);
        var node = this;
        var oldValues = {};
        var connOpts;
        var status;
        var readInProgress = false;
        var readDeferred = 0;
        var vars = config.vartable;
        var isVerbose = !!RED.settings.get('verbose');
        var connectTimeoutTimer;
        var connected = false;
        node.writeInProgress = false;
        node.writeQueue = [];

        RED.nodes.createNode(this, config);

        //avoids warnings when we have a lot of pcccIn nodes
        this.setMaxListeners(0);

        connOpts = {
            host: config.address,
            port: config.port
        }

        if(config.userouting) {
            connOpts.routing = Buffer.from((config.routing || '').replace(/(0x|,|\.)/g, ''), 'hex');
        }

        node._vars = createTranslationTable(vars);

        node.getStatus = function getStatus() {
            return status;
        }

        node.writeVar = function writeVar(obj) {
            node.writeQueue.push(obj);

            if(!node.writeInProgress) {
                writeNext();
            }

        };

        function onWritten(err) {
            node.writeInProgress = false;
            var elm = node.writeQueue.shift();

            writeNext();

            if (err) {
                manageStatus('badvalues');
                elm.done(RED._("pccc.error.badvalues"));
            } else {
                manageStatus('online');
                elm.done();
            }
        }

        function writeNext() {
            if (!connected) return; //keep everything in the queue to try again when we connect back

            var nextElm = node.writeQueue[0];
            if(nextElm) {
                node._conn.writeItems(nextElm.name, nextElm.val, onWritten);
                node.writeInProgress = true;
            }
        }

        function manageStatus(newStatus) {
            if (status == newStatus) return;

            status = newStatus;
            node.emit('__STATUS__', {
                status: status
            });
        }

        function cycleCallback(err, values) {
            readInProgress = false;

            if(readDeferred && connected) {
                doCycle();
                readDeferred = 0;
            }

            if (err) {
                manageStatus('badvalues');
                node.error(RED._("pccc.error.badvalues"));
                return;
            }

            manageStatus('online');

            var changed = false;
            node.emit('__ALL__', values);
            Object.keys(values).forEach(function(key) {
                if (oldValues[key] !== values[key]) {
                    changed = true;
                    node.emit(key, values[key]);
                    node.emit('__CHANGED__', {key: key, value: values[key]});
                    oldValues[key] = values[key];
                }
            });
            if (changed) node.emit('__ALL_CHANGED__', values);
        }

        function doCycle() {
            if(!readInProgress && connected) {
                node._conn.readAllItems(cycleCallback);
                readInProgress = true;
            } else {
                readDeferred++;

                if (readDeferred > 10) {
                    node.warn(RED._("pccc.error.noresponse"), {});
                    connect(); //this also drops any existing connection
                }
            }
        }

        function onConnect(err) {
            clearTimeout(connectTimeoutTimer);

            if (err) {
                manageStatus('offline');
                node.error(RED._("pccc.error.onconnect") + err.toString());

                connected = false;

                //try to reconnect if failed to connect
                connectTimeoutTimer = setTimeout(connect, 5000);

                return;
            }

            readInProgress = false;
            readDeferred = 0;
            connected = true;

            manageStatus('online');

            node._conn.setTranslationCB(function(tag) {
                return node._vars[tag];
            });
            node._conn.addItems(Object.keys(node._vars));
            node._td = setInterval(doCycle, config.cycletime);
        }

        function closeConnection(done) {
            //ensure we won't try to connect again if anybody wants to close it
            clearTimeout(connectTimeoutTimer);

            manageStatus('offline');
            clearInterval(node._td);

            function doCb() {
                node._conn = null;
                if (typeof done == 'function') done();
            }
            connected = false;

            if (node._conn) {
                node._conn.dropConnection(doCb);
            } else {
                process.nextTick(doCb);
            }
        }

        node.on('close', closeConnection);

        function connect() {
            function doConnect() {
                manageStatus('connecting');

                connected = false;
                node._conn = new nodepccc({
                    silent: !isVerbose,
                    debug: isVerbose
                });
                node._conn.globalTimeout = parseInt(config.timeout) || 4500;
                node._conn.initiateConnection(connOpts, onConnect);
            }

            if (node._conn) {
                closeConnection(doConnect);
            } else {
                process.nextTick(doConnect);
            }
        }

        manageStatus('offline');
        connect();
    }
    RED.nodes.registerType("pccc endpoint", pcccEndpoint);

    // ---------- pccc In ----------

    function pcccIn(config) {
        var node = this;
        var statusVal;
        RED.nodes.createNode(this, config);

        node.endpoint = RED.nodes.getNode(config.endpoint);
        if (!node.endpoint) {
            return node.error(RED._("pccc.in.error.missingconfig"));
        }

        function sendMsg(data, key, status) {
            if (key === undefined) key = '';
            var msg = {
                payload: data,
                topic: key
            };
            statusVal = status !== undefined ? status : data;
            node.send(msg);
            node.status(generateStatus(node.endpoint.getStatus(), statusVal));
        }

        function onChanged(variable) {
            sendMsg(variable.value, variable.key, null);
        }

        function onDataSplit(data) {
            Object.keys(data).forEach(function(key) {
                sendMsg(data[key], key, null)
            });
        }

        function onData(data) {
            sendMsg(data, config.mode == 'single' ? config.variable : '')
        }

        function onDataSelect(data) {
            onData(data[config.variable]);
        }

        function onEndpointStatus(s) {
            node.status(generateStatus(s.status, statusVal));
        }

        node.endpoint.on('__STATUS__', onEndpointStatus);

        if (config.diff) {
            switch (config.mode) {
                case 'all-split':
                    node.endpoint.on('__CHANGED__', onChanged);
                    break;
                case 'single':
                    node.endpoint.on(config.variable, onData);
                    break;
                case 'all':
                default:
                    node.endpoint.on('__ALL_CHANGED__', onData);
            }
        } else {
            switch (config.mode) {
                case 'all-split':
                    node.endpoint.on('__ALL__', onDataSplit);
                    break;
                case 'single':
                    node.endpoint.on('__ALL__', onDataSelect);
                    break;
                case 'all':
                default:
                    node.endpoint.on('__ALL__', onData);
            }
        }

        node.on('close', function(done) {
            node.endpoint.removeListener('__ALL__', onDataSelect);
            node.endpoint.removeListener('__ALL__', onDataSplit);
            node.endpoint.removeListener('__ALL__', onData);
            node.endpoint.removeListener('__ALL_CHANGED__', onData);
            node.endpoint.removeListener('__CHANGED__', onChanged);
            node.endpoint.removeListener('__STATUS__', onEndpointStatus);
            node.endpoint.removeListener(config.variable, onData);
            done();
        });
    }
    RED.nodes.registerType("pccc in", pcccIn);

    // ---------- pccc Out ----------

    function pcccOut(config) {
        var node = this;
        var statusVal;
        RED.nodes.createNode(this, config);

        node.endpoint = RED.nodes.getNode(config.endpoint);
        if (!node.endpoint) {
            return node.error(RED._("pccc.in.error.missingconfig"));
        }

        function onEndpointStatus(s) {
            node.status(generateStatus(s.status, statusVal));
        }

        function onNewMsg(msg, send, done) {
            var writeObj = {
                name: config.variable || msg.variable,
                val: msg.payload,
                done: done
            }

            if(!writeObj.name) return done(new Error("Could not identify variable to be written"));

            statusVal = writeObj.val;
            node.endpoint.writeVar(writeObj);
            node.status(generateStatus(node.endpoint.getStatus(), statusVal));
        }

        nrInputShim(node, onNewMsg)
        node.endpoint.on('__STATUS__', onEndpointStatus);

        node.on('close', function(done) {
            node.endpoint.removeListener('__STATUS__', onEndpointStatus);
            done();
        });
    }
    RED.nodes.registerType("pccc out", pcccOut);
};
