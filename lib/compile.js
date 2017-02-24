'use strict';

const BbPromise = require('bluebird');
const path = require('path');
const webpack = require('webpack');

module.exports = {
  compile() {
    this.serverless.cli.log('Bundling with Webpack...');

    const compiler = webpack(this.webpackConfig);

    return BbPromise
      .fromCallback(cb => compiler.run(cb))
      .then(stats => {

        this.serverless.cli.consoleLog(stats.toString({
          colors: true,
          hash: false,
          version: false,
          chunks: false,
          children: false
        }));
        if (stats.compilation.errors.length) {
          throw new Error('Webpack compilation error, see above');
        }

        // Set up the includes/exclude to only include the files we need
        if (this.serverless.service.package.individually) {
          const functionNames = this.serverless.service.getAllFunctions();
          const namedChunks = stats.compilation.namedChunks;
          functionNames.forEach(name => {
            const parsed = path.parse(this.serverless.service.functions[name].handler);
            const handlerPath = path.join(parsed.dir, parsed.name);
            let chunkFiles = getChunkFiles(namedChunks, handlerPath);
            const packageConfig = this.serverless.service.functions[name].package = this.serverless.service.functions[name].package || {}
            const originalInclude = packageConfig.include = packageConfig.include || []
            const includeMaps = this.serverless.service.custom && this.serverless.service.custom.webpackIncludeMaps
            if (!includeMaps) {
              chunkFiles = chunkFiles.filter(filePath => !/\.map/.test(filePath))
            }
            this.serverless.service.functions[name].package.include = [].concat(['!**'], chunkFiles, originalInclude);
          });
        }

        const outputPath = stats.compilation.compiler.outputPath;
        this.webpackOutputPath = outputPath;
        this.originalServicePath = this.serverless.config.servicePath;
        this.serverless.config.servicePath = outputPath;
        return stats;
      });
  },
};


function getChunkFiles(namedChunks, handlerPath) {
  const chunk = Object.keys(namedChunks)
    .map(key => namedChunks[key])
    .find(chunk => chunk.name.includes(handlerPath)) || {};
  return chunk.files || [];
}
