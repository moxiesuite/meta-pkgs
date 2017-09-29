meta-pkgs
=========

Plugin for [meta](https://github.com/mateodelnorte/meta).

Utility functions for juggling parts of your packages' dependency graph.


Installation
------------

In a `meta` project (root repo):

    $ npm install --save-dev meta-pkgs


Usage
-----

Sub-command                                           | Description
----------------------------------------------------- | -------------
[`meta pkgs do`](#meta-pkgs-do-pkg-cmd)               | Run a command for a given package
[`meta pkgs checkout`](#meta-pkgs-checkout-terms)     | Checkout specific branches for packages and dependencies
[`meta pkgs test`](#meta-pkgs-test-parents--children) | Run tests against a slice of the dependency graph


### `meta pkgs do <pkg> <cmd>`

Runs `<cmd>` in the repository directory for package `<pkg>`.


### `meta pkgs checkout <terms...>`

Runs `git checkout` for packages/branches specified by terms.

Each term should conform to `<pkg><selector><branch>`, where:
  - `<pkg>` is the name of a managed package (base or dependent)
  - `<selector>` is either `@`, to specify only that package, or `:`, to
      specify that package and all its descendent dependencies
  - `<branch>` is a branch name or a remote + branch.

Later terms specified override earlier terms.

For example:

    $ meta pkgs checkout base:develop util:cool-feature subutil@someone/fix-bug

Checks out:
  - `subutil` to branch `fix-bug`, tracking `someone/fix-bug`
  - `util` and all managed dependencies to `cool-feature` (except `subutil`)
  - `base` and all managed dependencies to `develop` (except dependencies of `util`)

Options:
  - `--strict` to fail if a given branch is missing (default is ignore)
  - `--greedy` to continue searching descendent dependencies if a branch is
      missing (default is to stop traversal)


### `meta pkgs test <parents...> :: <children...>`

Runs `npm test` for packages in dependency graph between parents and children.

Parents/children should be separated by `::`.

For example:

    $ meta pkgs test base :: util lib

Runs tests for all packages `base` depends on that also depend on either `util`
or `lib`.

Options:
  - `--strict=<parents|children|both>` to omit specified parents, children, or
      both from testing (default runs tests for packages specified)


