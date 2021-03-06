'use strict';

const BbPromise = require('bluebird');
const webpack = require('webpack');
const express = require('express');
const bodyParser = require('body-parser');
const urlJoin = require('url-join');

module.exports = {
  serve() {
    this.serverless.cli.log('Serving functions...');

    const compiler = webpack(this.webpackConfig);
    const funcConfs = this._getFuncConfigs();
    const app = this._newExpressApp(funcConfs);
    const port = this._getPort();

    this.serverless.cli.consoleLog('Waiting for compilation....')
    app.listen(port, () =>
      compiler.watch({}, (err, stats) => {
        if (err) {
          throw err;
        }
        this.serverless.cli.consoleLog('Compilation completed!')
        const loadedModules = [];
        for (let funcConf of funcConfs) {
          funcConf.handlerFunc = this.loadHandler(
            stats,
            funcConf.id,
            loadedModules.indexOf(funcConf.moduleName) < 0
          );
          loadedModules.push(funcConf.moduleName);
        }
      })
    );

    return BbPromise.resolve();
  },

  _newExpressApp(funcConfs) {
    const app = express();

    app.use(bodyParser.json({
      limit: '5mb',
      type: (req) => /json/.test(req.headers['content-type']),
    }));
    app.use(bodyParser.urlencoded({ extended: true }));

    for (let funcConf of funcConfs) {
      for (let httpEvent of funcConf.events) {
        const method = httpEvent.method.toLowerCase();
        let endpoint = urlJoin('/', httpEvent.path);
        if (this.options.stagePrefix) {
          const stage = this.options.stage ? this.options.stage : this.serverless.service.provider.stage
          endpoint = urlJoin('/', stage, endpoint);
        }
        const path = endpoint
          .replace(/\/\/}/g, '/')
          .replace(/\{proxy\+\}/g, '*')
          .replace(/\{(.+?)\}/g, ':$1');
        let handler = this._handlerBase(funcConf, httpEvent);
        let optionsHandler = this._optionsHandler;
        if (httpEvent.cors) {
          handler = this._handlerAddCors(handler, httpEvent);
          optionsHandler = this._handlerAddCors(optionsHandler, httpEvent);
        }
        app.options(path, optionsHandler);
        app[method === 'any' ? 'all' : method](
          path,
          handler
        );
        this.serverless.cli.consoleLog(`  ${method.toUpperCase()} - http://localhost:${this._getPort()}${endpoint}`);
      }
    }

    return app;
  },

  _getFuncConfigs() {
    const funcConfs = [];
    const inputfuncConfs = this.serverless.service.functions;
    for (let funcName in inputfuncConfs) {
      const funcConf = inputfuncConfs[funcName];
      const httpEvents = funcConf.events
        .filter(e => e.hasOwnProperty('http'))
        .map(e => e.http);
      if (httpEvents.length > 0) {
        funcConfs.push(Object.assign({}, funcConf, {
          id: funcName,
          events: httpEvents,
          moduleName: funcConf.handler.split('.')[0],
          handlerFunc: null,
        }));
      }
    }
    return funcConfs;
  },

  _getPort() {
    return this.options.port || 8000;
  },

  _handlerAddCors(handler, httpEvent) {
    const headers = [
      '*',
    ];

    let cors = {
      origins: ['*'],
      methods: ['OPTIONS'],
      headers,
    };

    if (typeof httpEvent.cors === 'object') {
      cors = httpEvent.cors;
      cors.methods = cors.methods || [];
      if (cors.headers) {
        if (!Array.isArray(cors.headers)) {
          const errorMessage = [
            'CORS header values must be provided as an array.',
            ' Please check the docs for more info.',
          ].join('');
          throw new this.serverless.classes.Error(errorMessage);
        }
      } else {
        cors.headers = headers;
      }

      if (cors.methods.indexOf('OPTIONS') === -1) {
        cors.methods.push('OPTIONS');
      }

      if (cors.methods.indexOf(httpEvent.method.toUpperCase()) === -1) {
        cors.methods.push(httpEvent.method.toUpperCase());
      }
    } else {
      cors.methods.push(httpEvent.method.toUpperCase());
    }

    return (req, res, next) => {
      res.header('Access-Control-Allow-Origin', cors.origins.join(','));
      res.header('Access-Control-Allow-Methods', cors.methods.join(','));
      res.header('Access-Control-Allow-Headers', cors.headers.join(','));
      handler(req, res, next);
    };
  },

  _handlerBase(funcConf, httpEvent) {
    const isLambdaProxyIntegration = httpEvent && httpEvent.integration !== 'lambda'

    return (req, res) => {
      const func = funcConf.handlerFunc;
      const event = {
        method: req.method,
        headers: req.headers,
        body: req.body,
        [isLambdaProxyIntegration ? 'pathParameters' : 'path']: req.params,
        [isLambdaProxyIntegration ? 'queryStringParameters' : 'query']: req.query
        // principalId,
        // stageVariables,
      };
      const context = this.getContext(funcConf.id);
      func(event, context, (err, resp) => {
        if (err) {
          return res.status(500).send(err);
        }

        if (isLambdaProxyIntegration) {
          if (resp.headers) {
            for (let header in Object.keys(resp.headers)) {
              res.header(header, resp.headers[header]);
            }
          }
          res.status(resp.statusCode || 200).send(resp.body);
        } else {
          res.status(200).send(resp);
        }
      });
    }
  },

  _optionsHandler(req, res) {
    res.sendStatus(200);
  },
};
