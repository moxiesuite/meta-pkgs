var _ = require('lodash');
var exec = require('meta-exec');
var fs = require('fs');
var getMetaFile = require('get-meta-file');
var path = require('path');
var util = require('util');

var debug = require('debug')('packages');
var {getCurrentBranch, verifyBranch, getFileContents} = require('./git');

function Packages(rootDir, options) {
  var self = this;

  options = options || {};
  options.logger = options.logger || console;

  // `true` means missing branch raises exception
  options.strict = options.strict || false;
  // `true` means selector term will continue to be applied to descendents
  options.greedy = options.greedy || false;

  this.options = options;
  this.logger = options.logger;

  // QUESTION should this handle being in a child directory of the root?
  this.baseJSON = require(path.join(rootDir, "package.json"));

  // hacky memoization
  this.previews = {};

  this.repos = getPackageDirs(rootDir);
  this.repos[this.baseJSON.name] = ".";

  this.preferences = {};
  this.notes = {};
}

Packages.prototype.exec = function(pkg, command) {
  var repoDir = this.repos[pkg];

  debug("exec in %s: %s", pkg, command);
  return new Promise(function(accept, reject) {
    exec({
      dir: repoDir,
      displayDir: pkg,
      command
    }, function(err, outputs) {  // err appears to not get populated
      if (outputs.error) {
        reject(outputs.error);
      } else {
        accept();
      }
    });
  });
};

/* returns a promise for the resulting state
 */
Packages.prototype.preview = function(pkg, action) {
  var self = this;

  action = action || {};

  // HACK to memoize this function
  let previewName = util.inspect({pkg, action});

  let existingPreview = this.previews[previewName];
  if (existingPreview) {
    return Promise.resolve(existingPreview);
  }

  let previewBranch = action.checkout || getCurrentBranch(this.repos[pkg]);

  return Promise.resolve()
    .then(function() {
      if (!verifyBranch(self.repos[pkg], previewBranch)) {
        throw new Error(`Unable to use branch ${previewBranch}`);
      }

      let parsed = JSON.parse(
        getFileContents(self.repos[pkg], previewBranch, "package.json")
      );
      self.previews[previewName] = parsed;
      return parsed;
    });
};

Packages.prototype.dependenciesOf = function(pkgOrJSON, options) {
  var self = this;

  options = options || {};
  options.dev = options.dev || false;
  options.devOnly = options.devOnly || false;

  var promise;
  if (typeof pkgOrJSON === "string") {
    promise = this.preview(pkgOrJSON);
  } else {
    promise = Promise.resolve(pkgOrJSON);
  }

  return promise
    .then(function(json) {
      var dependencies = [];
      if (!options.devOnly) {
        var names = Object.keys(json.dependencies || {});
        dependencies = dependencies.concat(names);
      }

      if (options.devOnly || options.dev) {
        var names = Object.keys(json.devDependencies || {});
        dependencies = dependencies.concat(names);
      }

      return dependencies.filter(function(pkg) { return !!(self.repos[pkg]); });
    });
};

Packages.prototype.dependingOn = function(pkgOrJSON, options) {
  var self = this;

  options = options || {};
  options.dev = options.dev || false;
  options.devOnly = options.devOnly || false;

  var promise;
  var pkg;
  if (typeof pkgOrJSON === "string") {
    pkg = pkgOrJSON;
    promise = this.preview(pkgOrJSON);
  } else {
    pkg = pkgOrJSON.name;
    promise = Promise.resolve(pkgOrJSON);
  }

  return promise
    .then(function(json) {
      // maps to a promise for a list of results,
      // each result being a package name and whether or not that package
      // depends on `pkg`
      let pairsPromises = Object.keys(self.repos)
        .map(function(other) {
          return self.dependenciesOf(other, options)
            .then(function(dependencies) {
              return [other, dependencies.indexOf(pkg) !== -1];
            });
        });

      return Promise.all(pairsPromises);
    })
    .then(function(pairs) {
      return pairs
        .filter(function(pair) { return pair[1]; })
        .map(function(pair) { return pair[0]; })
    });
}

/* record a preference for a given action for a package
 * returns a promise of the preference having been recorded
 */
Packages.prototype.prefer = function(pkg, action) {
  var self = this;

  return this.preview(pkg, action)
    .then(function(json) {
      debug("pkg: %s, action: %o", pkg, action);
      self.preferences[pkg] = self.preferences[pkg] || {};
      debug("preferences: %o", self.preferences[pkg]);
      _.assign(self.preferences[pkg], action);
      return json;
    });
};

/* record a preference for a given action for a package + descendents
 * tree
 */
Packages.prototype.preferRecursively = function(pkg, action, options) {
  var self = this;

  options = options || {};
  options.reverse = options.reverse || false;

  // default is to search pkg dependencies, `reverse` specifies searching
  // pkg *dependents* instead.
  var nextPkgsPromise = options.reverse && this.dependingOn.bind(this) ||
    this.dependenciesOf.bind(this);

  var valid;
  return this.prefer(pkg, action)
    .then(function(json) {
      valid = true;
      return json;
    })
    .catch(function(err) {
      debug("skipping pkg: %s", pkg);
      valid = false;

      if (self.options.strict) {
        throw new Error(`Invalid preference for ${pkg}`);
      }

      self.notes[pkg] = self.notes[pkg] || [];
      self.notes[pkg].push({ignore: action});

      let bestKnownPref = self.preferences[pkg];
      return self.preview(pkg, bestKnownPref);
    })
    .then(function(json) {
      if (!valid && !self.options.greedy) {
        return Promise.resolve([]);
      }

      return nextPkgsPromise(json, {dev: true});
    })
    .then(function(nextPkgs) {
      debug("pkg %s, dependencies: %o", pkg, nextPkgs);
      let recursions = nextPkgs.map(function(nextPkg) {
        return self.preferRecursively(nextPkg, action, options);
      });

      return Promise.all(recursions);
    });
};

function getPackageDirs(rootDir) {
  rootDir = rootDir || process.cwd();

  var meta = getMetaFile({ confirmInMetaRepo: true});
  var projects = meta.projects;

  pkgDirs = {};

  Object.keys(projects).forEach(function(projectDir) {
    let jsonPath = path.join(rootDir, projectDir, "package.json");

    if (fs.existsSync(jsonPath)) {
      var json = require(jsonPath);
      pkgDirs[json.name] = projectDir;
    }
  });

  return pkgDirs;
}

module.exports = Packages;
