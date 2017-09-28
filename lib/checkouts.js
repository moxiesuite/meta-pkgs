var chalk = require('chalk');
var debug = require('debug')('checkouts');

var Packages = require('./packages');
var {getLocalBranchInfo} = require('./git');


function Checkouts(rootDir, options) {
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


Checkouts.prototype.specify = function(term) {
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

Checkouts.prototype.inform = function(pkg) {
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

Checkouts.prototype.checkout = function(pkg) {
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
      let {branch, remoteBranch, exists} = getLocalBranchInfo(repoDir, specifiedBranch);

      if (exists) {
        debug("using local %s", specifiedBranch);
        return self.packages.exec(pkg, `git checkout ${branch}`);
      }

      debug('creating local "%s" for remote "%s"', branch, remoteBranch);
      let command = `git checkout -b ${branch} ${remoteBranch}`;
      return self.packages.exec(pkg, command);
    });

}

Checkouts.prototype.run = function() {
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

module.exports = Checkouts;
