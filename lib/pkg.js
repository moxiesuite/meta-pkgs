var exec = require('meta-exec');
var fs = require('fs');
var getMetaFile = require('get-meta-file');
var path = require('path');

var debug = require('debug')('pkg');
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

  this.repos = getPackageDirs(rootDir);
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
  action.checkout = action.checkout || getCurrentBranch(this.repos[pkg]);

  return Promise.resolve()
    .then(function() {
      if (!verifyBranch(self.repos[pkg], action.checkout)) {
        throw new Error(`Unable to use branch ${action.checkout}`);
      }

      return JSON.parse(
        getFileContents(self.repos[pkg], action.checkout, "package.json")
      );
    });
};

/* record a preference for a given action for a package
 * returns a promise of the preference having been recorded
 */
Packages.prototype.prefer = function(pkg, action) {
  var self = this;
  return this.preview(pkg, action)
    .then(function(json) {
      debug("pkg: %s, action: %o", pkg, action);
      self.preferences[pkg] = action;
      return json;
    });
};

/* record a preference for a given action for a package + descendents
 * tree
 */
Packages.prototype.preferRecursively = function(pkg, action) {
  var self = this;
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
        return;
      }

      let dependencies = Array.from(
        new Set(Object.keys(json.dependencies || {}).concat(
          Object.keys(json.devDependencies || {})
        ))
      ).filter(function(dep) { return !!(self.repos[dep]) });

      let recursions = dependencies.map(function(dep) {
        return self.preferRecursively(dep, action);
      });

      return Promise.all(recursions);
    });
};

function getPackageDirs(rootDir) {
  rootDir = rootDir || process.cwd();

  var meta = getMetaFile({ confirmInMetaRepo: true});
  var projects = meta.projects;

  // QUESTION should this handle being in a child directory of the root?
  var baseJSON = require(path.join(rootDir, "package.json"));

  // include base project
  pkgDirs = {
    [baseJSON.name]: "."
  };

  // and all managed dependencies
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
