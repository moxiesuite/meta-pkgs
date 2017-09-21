var fs = require('fs');
var getMetaFile = require('get-meta-file');
var path = require('path');

var exec = require('meta-exec');
var runSync = require('./runSync');

var debug = require('debug')('meta-tc:checkout');
var {parseTerm} = require("../lib/args");


function MetaCheckout(rootDir, options) {
  var self = this;

  options = options || {};
  options.logger = options.logger || console;
  options.fetch = options.fetch || false;

  // `true` means missing branch raises exception
  options.strict = options.strict || false;
  // `true` means selector term will continue to be applied to descendents
  options.greedy = options.greedy || false;

  this.options = options;
  this.logger = options.logger;

  this.packages = {};

  var pkgDirs = getPackageDirs(rootDir);
  Object.keys(pkgDirs).forEach(function(pkg) {
    var repoDir = pkgDirs[pkg];
    self.packages[pkg] = { repoDir };
    self.packages[pkg] = self.inspect(pkg);
  });
};

MetaCheckout.prototype.inspect = function(pkg) {
  var self = this;

  let { repoDir } = this.packages[pkg];

  var repoBranch = getCurrentBranch(repoDir);

  let state = {
    repoDir,
    currentBranch: repoBranch,
    // starts the same as current state, to fall back to
    preferredBranch: repoBranch
  };

  return state;
};

MetaCheckout.prototype.exec = function(pkg, command) {
  var { repoDir } = this.packages[pkg];

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

MetaCheckout.prototype.getDependenciesAtBranch = function(pkg, branch) {
  var self = this;

  let { repoDir } = this.packages[pkg];

  let json = JSON.parse(getFileContents(repoDir, branch, "package.json"));

  var deps = Array
    .from(new Set(
      Object.keys(json.dependencies || {})
      .concat(Object.keys(json.devDependencies || {}))
    ))
    .filter(function(dep) { return !!(self.packages[dep]) });

  return deps;
};

MetaCheckout.prototype.request = function(pkg, branch) {
  if (!this.packages[pkg]) {
    throw new Error(`Package "${pkg}" is not managed by meta`);
  }

  var repo = this.packages[pkg];
  repo.preferredBranch = branch;
};

MetaCheckout.prototype.requestRecursively = function(pkg, branch) {
  var self = this;

  let { repoDir, preferredBranch } = this.packages[pkg];
  let shouldRecurse = true; // unless fallback+options indicates otherwise

  var ownBranch;

  if (verifyBranch(repoDir, branch)) {
    ownBranch = branch;
  } else {
    debug("%s: branch `%s` unavailable, leaving unchanged (`%s`)", pkg, branch, preferredBranch);

    // not defaulting to unchanged means error condition
    if (this.options.strict) {
      throw new Error(`Attempting to checkout "${pkg}" to unknown branch "${branch}"`);
    }

    shouldRecurse = this.options.greedy;
    ownBranch = preferredBranch;
  }

  this.request(pkg, ownBranch);

  if (shouldRecurse) {
    this.getDependenciesAtBranch(pkg, ownBranch)
      .forEach(function(depPkg) {
        self.requestRecursively(depPkg, branch);
      });
  }
};

MetaCheckout.prototype.specify = function(term) {
  let {pkg, selector, branch} = parseTerm(term);

  switch (selector) {
    case '@':
      this.request(pkg, branch);
    break;
    case ':':
      this.requestRecursively(pkg, branch);
    break;
    default:
      throw new Error("Unknown selector: " + selector);
  }
};

MetaCheckout.prototype.checkout = function(pkg) {
  var self = this;
  let { repoDir, currentBranch, preferredBranch } = this.packages[pkg];

  if (currentBranch === preferredBranch) {
    return;
  }

  if (this.options.fetch) {
    this.exec(pkg, `git fetch --all`);
  }

  debug("checking out %s: %s", pkg, preferredBranch);

  var command;
  if (verifyLocalBranch(repoDir, preferredBranch)) {
    command = `git checkout ${preferredBranch}`;
  } else {
    let match = preferredBranch.match(/(([^\/]*)\/)?(.*)/);
    //                                  `------'    `--'
    //                                   remote     branch
    let remote = match[2] || "origin";
    let branch = match[3];

    let remoteBranch = `${remote}/${branch}`;
    // if local branch already exists, e.g. checking out `my-fork/master`
    // then use full `my-fork/master` as local branch name
    let localBranch = verifyLocalBranch(repoDir, branch) ? remoteBranch : branch;

    command = `git checkout -b ${localBranch} ${remoteBranch}`;
  }

  return this.exec(pkg, command);
}

MetaCheckout.prototype.run = function() {
  debug("this.packages: %o", this.packages)
  return Promise.all(Object.keys(this.packages).map(this.checkout.bind(this)));
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

function getCurrentBranch(repoDir) {
  let result = runSync(
    "git", ["rev-parse", "--abbrev-ref", "HEAD"], repoDir, this.logger, true
  );
  return result.stdout.toString().trim();
}

function verifyBranch(repoDir, branch) {
  // if branch exists locally, we're good
  if (verifyLocalBranch(repoDir, branch)) {
    return true;
  }

  // otherwise, try branch after munging to :remote/:branch format
  if (!branch.match(/.*\/.*/)) {
    branch = `origin/${branch}`;
  }

  try {
    runSync("git", ["rev-parse", "--verify", branch], repoDir, this.logger, true);
    return true;
  } catch (e) {
    return false;
  }
}

function verifyLocalBranch(repoDir, branch) {
  try {
    runSync(
      "git", ["rev-parse", "--verify", `refs/heads/${branch}`],
      repoDir, this.logger, true
    );
    return true;
  } catch (e) {
    return false;
  }
}


function getFileContents(repoDir, branch, filename) {
  if (!verifyLocalBranch(repoDir, branch)) {
    let match = branch.match(/(([^\/]*)\/)?(.*)/);
    //                         `------'    `--'
    //                          remote     branch
    let remote = match[2] || "origin";
    branch = `${remote}/${match[3]}`;
  }

  let result = runSync(
    "git", ["show", branch + ":" + filename], repoDir, this.logger, true
  );
  return result.stdout.toString();
}

module.exports = MetaCheckout;
