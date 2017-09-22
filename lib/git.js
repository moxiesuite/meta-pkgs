var debug = require('debug')('tc:git');

var runSync = require('./runSync');

function getCurrentBranch(repoDir) {
  let result = runSync(
    "git", ["rev-parse", "--abbrev-ref", "HEAD"], repoDir, this.logger, true
  );
  return result.stdout.toString().trim();
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

module.exports = {
  getCurrentBranch,
  getFileContents,
  verifyBranch,
  verifyLocalBranch
};
