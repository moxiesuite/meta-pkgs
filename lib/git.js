var debug = require('debug')('tc:git');

var runSync = require('./runSync');

function getCurrentBranch(repoDir) {
  let result = runSync(
    "git", ["rev-parse", "--abbrev-ref", "HEAD"], repoDir, this.logger, true
  );
  return result.stdout.toString().trim();
}

function getLocalBranchInfo(repoDir, specifiedBranch) {
  if (verifyLocalBranch(repoDir, specifiedBranch)) {
    return {branch: specifiedBranch, exists: true};
  }

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

  let { remote, branch } = parseBranch(specifiedBranch);
  let remoteBranch = `${remote}/${branch}`;

  let shortNameExists = verifyLocalBranch(repoDir, branch);
  if (!shortNameExists) {
    return {branch, remoteBranch, exists: false};
  }

  let shortNameTracksRemote = branchTracksRemote(repoDir, branch, remote);
  if (shortNameTracksRemote) {
    return {branch, exists: true};
  }

  return {branch: `${remote}/${branch}`, remoteBranch, exists: false};
}

function branchTracksRemote(repoDir, branch, remote) {
  try {
    let result = runSync(
      "git", ["config", `branch.${branch}.remote`],
      repoDir, this.logger, true
    );
    let actualRemote = result.stdout.toString().trim();
    return remote == actualRemote;
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

function getFileContents(repoDir, specifiedBranch, filename) {
  if (!verifyLocalBranch(repoDir, specifiedBranch)) {
    let { remote, branch } = parseBranch(specifiedBranch);
    specifiedBranch = `${remote}/${branch}`;
  }

  let result = runSync(
    "git", ["show", specifiedBranch + ":" + filename], repoDir, this.logger, true
  );
  return result.stdout.toString();
}

function parseBranch(specifiedBranch) {
  let match = specifiedBranch.match(/(([^\/]*)\/)?(.*)/);
  //                                  `------'    `--'
  //                                   remote     branch
  let remote = match[2] || "origin";
  let branch = match[3];

  return { remote, branch };
}


module.exports = {
  getCurrentBranch,
  getFileContents,
  getLocalBranchInfo,
  parseBranch,
  verifyBranch,
  verifyLocalBranch
};
