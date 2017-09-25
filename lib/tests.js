var chalk = require('chalk');
var debug = require('debug')('tests');
var fs = require('fs');
var path = require('path');

var Packages = require('./packages');

function Tests(rootDir, options) {
  var self = this;

  debug("options: %o", options);
  options = options || {};
  options.logger = options.logger || console;

  // `true` means specified ancestors will not be tested
  options.strictParents = options.strictParents || false;
  // `true` means specified descendents will not be tested
  options.strictChildren = options.strictChildren || false;

  this.options = options;
  this.logger = options.logger;


  this.packages = new Packages(rootDir, options);
}

Tests.prototype.include = function(parents, children) {
  var self = this;

  var chain = Promise.resolve();
  parents.forEach(function(parent) {
    chain = chain.then(function() {
      debug("descending from %s", parent);
      return self.packages.preferRecursively(
        parent, {testDescendents: true}
      );
    });

    if (self.options.strictParents) {
      chain = chain.then(function() {
        debug("omitting %s", parent);
        return self.packages.prefer(parent, {omit: true});
      });
    };
  });

  children.forEach(function(child) {
    chain = chain.then(function() {
      debug("descending to %s", child);
      return self.packages.preferRecursively(
        child, {testAncestors: true}, {
          reverse: true
        }
      );
    });

    if (self.options.strictChildren) {
      chain = chain.then(function() {
        debug("omitting %s", child);
        return self.packages.prefer(child, {omit: true});
      });
    };
  });

  chain.then(function() {
    debug("self.packages.preferences: %O", self.packages.preferences);
  });

  return chain;
};

/* processing command line args into lists of parents and children
 */
Tests.prototype.parseArgs = function (args) {
  var parents = [];
  var children = [];

  if (args.length == 0) {
    parents = [self.packages.baseJSON.name];
    children = [self.packages.baseJSON.name];
  } else if (args.length == 1) {
    parents = [args[0]];
    children = [args[0]];
  } else if (args.length == 2) {
    parents = [args[0]];
    children = [args[1]];
  } else {
    var separatorIndex = args.indexOf("::");

    if (separatorIndex == -1) {
      throw new Error(
        "Invalid arguments format, must specify `::` to separate parent/child arguments"
      );
    }

    parents = args.slice(0, separatorIndex);
    children = args.slice(separatorIndex + 1);
  }

  return Promise.resolve({
    parents: parents,
    children: children
  });
}

Tests.prototype.test = function(pkg) {
  return this.packages.exec(pkg, `npm test`);
};

Tests.prototype.run = function() {
  var self = this;

  var failed = [];

  return this.resolve()
    .then(function(pkgs) {
      debug("pkgs to test: %o", pkgs);
      var tests = Promise.resolve();

      let withTests = pkgs.filter(function(pkg) {
        return hasTests(self.packages.repos[pkg]);
      })

      withTests.forEach(function(pkg) {
        tests = tests.then(function() {
          return self.test(pkg);
        })
        .catch(function(err) {
          failed.push(pkg);
        });
      });

      return tests.then(function() {
        if (failed.length > 0) {
          throw new Error(`Tests failed for packages: ${failed.join(", ")}`);
        }
      });
    });
};

Tests.prototype.resolve = function() {
  var self = this;

  var pkgs = Object.keys(this.packages.preferences).filter(function(pkg) {
    let action = self.packages.preferences[pkg];
    return !action.omit && action.testDescendents && action.testAncestors;
  });

  return Promise.resolve(pkgs);
};

function hasTests(repoDir) {
  var json = require(path.resolve(repoDir, "package.json"));

  if (!json.scripts.test) {
    return false;
  }

  // hack because mocha doesn't have a dry run
  var hasTestDirectory = (
    fs.existsSync(path.resolve(repoDir, "test")) ||
    fs.existsSync(path.resolve(repoDir, "tests"))
  );

  if (!hasTestDirectory) {
    return false;
  }

  return true;
}

module.exports = Tests;
