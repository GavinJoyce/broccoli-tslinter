var Filter = require('broccoli-persistent-filter');
var chalk = require('chalk');
var existsSync = require('exists-sync');
var path = require('path');
var Linter = require("tslint");
var fs = require('fs');

function TSLint(inputNode, options) {
  if (!(this instanceof TSLint)) {
    return new TSLint(inputNode, options);
  }
  options = options || {};

  this.options = {
    configuration: {
      rules: {}
    },
    outputFile: options.outputFile,
    failBuild: options.failBuild || false,
    disableTestGenerator: options.disableTestGenerator || false,
    testGenerator: options.testGenerator || null,
    logError: options.logError
  };

  var tslintConfigPath = path.resolve('tslint.json');
  if (options.configuration) {
    tslintConfigPath = path.resolve(options.configuration);
  } else {
    console.log(this.createLogMessage('Using tslint.json as the default file for linting rules', 'blue'));
  }

  if (!existsSync(tslintConfigPath)) {
    throw new Error('Cannot find tslint configuration file: ' + tslintConfigPath);
  }

  try {
    this.options.configuration = JSON.parse(fs.readFileSync(tslintConfigPath, 'utf8'));
  } catch (e) {
    var message = 'Cannot parse configuration file: ' + tslintConfigPath;
    throw new Error(this.createLogMessage(message, 'red'));
  }

  if (!this.options.configuration.rules) {
    // rules need to be defined in the configuration
    var message = 'The format of the config file is { rules: { /* rules list */ } }, where /* rules list */ is a key: value comma-seperated list of rulename: rule-options pairs.';
    throw new Error(this.createLogMessage(message, 'red'));
  }

  if (Object.keys(this.options.configuration.rules).length === 0) {
    var message = 'No rules defined for linting';
    console.log(this.createLogMessage(message, 'yellow'));
  }

  if (!options.formatter) {
    // default formatter
    this.options.formatter = 'prose';
  }

  Filter.call(this, inputNode, {
    annotation: options.annotation
  });
}

TSLint.prototype = Object.create(Filter.prototype);
TSLint.prototype.constructor = TSLint;
// only touch typescript files
TSLint.prototype.extensions = ['ts'];
TSLint.prototype.targetExtension = 'tslint.ts';

TSLint.prototype.build = function () {
  this.totalFiles = 0;
  this.failureCount = 0;
  this._errors = [];

  var self = this;

  return Filter.prototype.build.call(this)
  .finally(function() {
    var outputLog = '';
    if (self.failureCount > 0) {
      // linting error in ts files
      var message = '======= Found ' + self.failureCount + ' tslint errors in ' + self.totalFiles + ' files =======';
      var summaryMessage = self.createLogMessage(message, 'yellow');
      self.logError(summaryMessage);
      outputLog += '\n' + self._errors.join('\n');
    } else {
      // all files are lint free
      outputLog += self.createLogMessage('Finished linting ' + self.totalFiles + ' successfully', 'green');
    }

    if (self.options.outputFile) {
      // write to file
      var outputPath = path.join(self.options.outputFile);
      fs.writeFileSync(outputPath, outputLog, 'utf8');
      console.log(self.createLogMessage('Lint output written to file: ' + outputPath, 'blue'));
    } else {
      // throw in stdout
      console.log(outputLog);
      if (self.options.failBuild && self.failureCount > 0) {
        throw new Error('Build failed due to lint errors!');
      }
    }
  })
}

TSLint.prototype.processString = function(content, relativePath) {
  var linter = new Linter(relativePath, content, this.options);
  var result = linter.lint();

  this.totalFiles++;

  var isLintNotPassed = result.failureCount > 0;
  if (isLintNotPassed > 0) {
    // error is seen
    this.failureCount += result.failureCount;

    result.output.split('\n').forEach(function (line) {
      this.logError(line);
    }, this);
  }

  var output = '';
  if (!this.options.disableTestGenerator) {
    output = this.testGenerator(relativePath, isLintNotPassed, result.output)
  }

  return {
    output: output,
    didPass: isLintNotPassed,
    errors: result.output
  }
};

TSLint.prototype.testGenerator = function(relativePath, passed, errors) {
  if (errors) {
    errors = '\\n' + this.escapeErrorString(errors);
  } else {
    errors = '';
  }

  if (this.options.testGenerator) {
    return this.options.testGenerator.call(this, relativePath, passed, errors);
  } else {
    return "" +
      "QUnit.module('JSHint - " + path.dirname(relativePath) + "');\n" +
      "QUnit.test('" + relativePath + " should pass jshint', function(assert) { \n" +
      "  assert.expect(1);\n" +
      "  assert.ok(" + !!passed + ", '" + relativePath + " should pass jshint." + errors + "'); \n" +
      "});\n";
  }
};

TSLint.prototype.escapeErrorString = function(string) {
  string = string.replace(/\n/gi, "\\n");
  string = string.replace(/'/gi, "\\'");

  return string;
};

TSLint.prototype.createLogMessage = function(message, color) {
  return chalk[color](message);
}

TSLint.prototype.logError = function(errorMsg, color) {
  var color = color || 'red';

  this._errors.push(chalk[color](errorMsg));

  if (this.options.logError) {
    // custom log error function for tests
    this.options.logError.call(this, errorMsg);
  }
}

module.exports = TSLint;
