var chalk = require('chalk');
var debug = require('debug')('meta-tc:checkout');

var Packages = require('./packages');
var {verifyLocalBranch} = require('./git');


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

  this.packages = new Packages(rootDir, options);
};


MetaCheckout.prototype.specify = function(term) {
  var self = this;

  return Promise.resolve()
    .then(function() {
      let {pkg, selector, branch} = parseTerm(term);

      switch (selector) {
        case '@':
          return self.packages.prefer(pkg, {checkout: branch});
        break;
        case ':':
          return self.packages.preferRecursively(pkg, {checkout: branch});
        break;
        default:
          throw new Error("Unknown selector: " + selector);
      }
    })
    .catch(function(err) {
      throw new Error(
        `Could not fully process "${term}".\nGot error: ${err.message}`
      );
    });
};

MetaCheckout.prototype.inform = function(pkg) {
  var self = this;

  let note = this.packages.notes[pkg].pop();
  debug("%s note: %O", pkg, note);

  let unselectedBranch = note.ignore.checkout;

  let message = `Skipping checkout: unknown branch "${unselectedBranch}"`;
  let highlight = `${pkg} -`;

  return Promise.resolve()
    .then(function() {
      self.logger.log(
        `\n${chalk.cyan(pkg)}: ${chalk.yellow.dim("skipping unknown branch")} ` +
          chalk.yellow.bold(unselectedBranch)
      );
    });
};

MetaCheckout.prototype.checkout = function(pkg) {
  var self = this;

  let repoDir = this.packages.repos[pkg];
  let action = this.packages.preferences[pkg];

  var specifiedBranch = action.checkout;

  return Promise.resolve()
    .then(function() {
      if (self.options.fetch) {
        return self.packages.exec(pkg, `git fetch --all`);
      }
    })
    .then(function() {
      let alreadyExists = verifyLocalBranch(repoDir, specifiedBranch);

      if (alreadyExists) {
        debug("using local %s", specifiedBranch);
        return self.packages.exec(`git checkout ${specifiedBranch}`);
      }

      // branch does not exist as specified, must create tracking branch
      //
      // here be minor dragons: attempts to approximate git behavior,
      // e.g. how typing:
      //
      //     git checkout develop
      //
      // automatically turns into:
      //
      //     git checkout -b develop origin/develop
      //
      // i.e. name the tracking branch
      //   - with just the branch portion IFF that name is available
      //   - otherwise, use the full name

      debug("checking out %s: %s", pkg, specifiedBranch);
      let { remote, branch } = parseBranch(specifiedBranch);

      let shortNameAvailable = !verifyLocalBranch(repoDir, branch);
      debug("short name available: %b", shortNameAvailable);

      var remoteBranch = `${remote}/${branch}`;

      var localBranch;
      if (shortNameAvailable) {
        localBranch = branch;
      } else {
        localBranch = remoteBranch;
      }

      debug('creating local "%s" for remote "%s"', localBranch, remoteBranch);

      let command = `git checkout -b ${localBranch} ${remoteBranch}`;
      return self.packages.exec(pkg, command);
    });

}

MetaCheckout.prototype.run = function() {
  var self = this;

  let pkgs = Object.keys(this.packages.preferences);
  let notedPkgs = Object.keys(this.packages.notes).filter(function(pkg) {
    return pkgs.indexOf(pkg) === -1
  });

  return Promise.resolve()
    .then(function() {
      let informPromises = notedPkgs.map(self.inform.bind(self));
      return Promise.all(informPromises);
    })
    .then(function() {
      let checkoutPromises = pkgs.map(self.checkout.bind(self));
      return Promise.all(checkoutPromises);
    });


};


function parseTerm(term) {
  let match = term.match(/(.*)(@|:)(.*)/);
  return {
    pkg: match[1],
    selector: match[2],
    branch: match[3]
  };
}

function parseBranch(specifiedBranch) {
  let match = specifiedBranch.match(/(([^\/]*)\/)?(.*)/);
  //                                  `------'    `--'
  //                                   remote     branch
  let remote = match[2] || "origin";
  let branch = match[3];

  return { remote, branch };
}

module.exports = MetaCheckout;
