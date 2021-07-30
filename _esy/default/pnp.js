#!/usr/bin/env node
/* eslint-disable max-len, flowtype/require-valid-file-annotation, flowtype/require-return-type */
/* global packageInformationStores, $$BLACKLIST, $$SETUP_STATIC_TABLES */

// Used for the resolveUnqualified part of the resolution (ie resolving folder/index.js & file extensions)
// Deconstructed so that they aren't affected by any fs monkeypatching occuring later during the execution
const {statSync, lstatSync, readlinkSync, readFileSync, existsSync, realpathSync} = require('fs');

const Module = require('module');
const path = require('path');
const StringDecoder = require('string_decoder');

const $$BLACKLIST = null;
const ignorePattern = $$BLACKLIST ? new RegExp($$BLACKLIST) : null;

const pnpFile = path.resolve(__dirname, __filename);
const builtinModules = new Set(Module.builtinModules || Object.keys(process.binding('natives')));

const topLevelLocator = {name: null, reference: null};
const blacklistedLocator = {name: NaN, reference: NaN};

// Used for compatibility purposes - cf setupCompatibilityLayer
const patchedModules = new Map();
const fallbackLocators = [topLevelLocator];

// Matches backslashes of Windows paths
const backwardSlashRegExp = /\\/g;

// Matches if the path must point to a directory (ie ends with /)
const isDirRegExp = /\/$/;

// Matches if the path starts with a valid path qualifier (./, ../, /)
// eslint-disable-next-line no-unused-vars
const isStrictRegExp = /^\.{0,2}/;

// Splits a require request into its components, or return null if the request is a file path
const pathRegExp = /^(?![A-Za-z]:)(?!\.{0,2}(?:\/|$))((?:@[^\/]+\/)?[^\/]+)\/?(.*|)$/;

// Keep a reference around ("module" is a common name in this context, so better rename it to something more significant)
const pnpModule = module;

/**
 * Used to disable the resolution hooks (for when we want to fallback to the previous resolution - we then need
 * a way to "reset" the environment temporarily)
 */

let enableNativeHooks = true;

/**
 * Simple helper function that assign an error code to an error, so that it can more easily be caught and used
 * by third-parties.
 */

function makeError(code, message, data = {}) {
  const error = new Error(message);
  return Object.assign(error, {code, data});
}

/**
 * Ensures that the returned locator isn't a blacklisted one.
 *
 * Blacklisted packages are packages that cannot be used because their dependencies cannot be deduced. This only
 * happens with peer dependencies, which effectively have different sets of dependencies depending on their parents.
 *
 * In order to deambiguate those different sets of dependencies, the Yarn implementation of PnP will generate a
 * symlink for each combination of <package name>/<package version>/<dependent package> it will find, and will
 * blacklist the target of those symlinks. By doing this, we ensure that files loaded through a specific path
 * will always have the same set of dependencies, provided the symlinks are correctly preserved.
 *
 * Unfortunately, some tools do not preserve them, and when it happens PnP isn't able anymore to deduce the set of
 * dependencies based on the path of the file that makes the require calls. But since we've blacklisted those paths,
 * we're able to print a more helpful error message that points out that a third-party package is doing something
 * incompatible!
 */

// eslint-disable-next-line no-unused-vars
function blacklistCheck(locator) {
  if (locator === blacklistedLocator) {
    throw makeError(
      `BLACKLISTED`,
      [
        `A package has been resolved through a blacklisted path - this is usually caused by one of your tools calling`,
        `"realpath" on the return value of "require.resolve". Since the returned values use symlinks to disambiguate`,
        `peer dependencies, they must be passed untransformed to "require".`,
      ].join(` `)
    );
  }

  return locator;
}

let packageInformationStores = new Map([
["@esy-ocaml/libffi",
new Map([["3.2.10",
         {
           packageLocation: "/Users/mando/.esy/source/i/esy_ocaml__s__libffi__3.2.10__b56d4f27/",
           packageDependencies: new Map([["@esy-ocaml/libffi", "3.2.10"]])}]])],
  ["@esy-ocaml/reason",
  new Map([["github:EduardoRFS/reason:reason.json#35aa4df3de0daa60bdc1133dcf97855decac48f7",
           {
             packageLocation: "/Users/mando/.esy/source/i/esy_ocaml__s__reason__49164b1c/",
             packageDependencies: new Map([["@esy-ocaml/reason",
                                           "github:EduardoRFS/reason:reason.json#35aa4df3de0daa60bdc1133dcf97855decac48f7"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/fix", "opam:20201120"],
                                             ["@opam/menhir",
                                             "opam:20210419"],
                                             ["@opam/merlin-extend",
                                             "opam:0.6"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["@opam/ppx_derivers",
                                             "opam:1.2.1"],
                                             ["@opam/result", "opam:1.5"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@esy-ocaml/substs",
  new Map([["0.0.1",
           {
             packageLocation: "/Users/mando/.esy/source/i/esy_ocaml__s__substs__0.0.1__19de1ee1/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"]])}]])],
  ["@opam/angstrom",
  new Map([["opam:0.15.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__angstrom__opam__c__0.15.0__c5dca2a1/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/angstrom",
                                             "opam:0.15.0"],
                                             ["@opam/bigstringaf",
                                             "opam:0.8.0"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ocaml-syntax-shims",
                                             "opam:1.0.0"],
                                             ["@opam/result", "opam:1.5"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/asetmap",
  new Map([["opam:0.8.1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__asetmap__opam__c__0.8.1__a7c0b750/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/asetmap", "opam:0.8.1"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.0"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["@opam/topkg", "opam:1.0.3"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/asn1-combinators",
  new Map([["opam:0.2.5",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__asn1_combinators__opam__c__0.2.5__7e4e5b79/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/asn1-combinators",
                                             "opam:0.2.5"],
                                             ["@opam/bigarray-compat",
                                             "opam:1.0.0"],
                                             ["@opam/cstruct", "opam:6.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ptime", "opam:0.8.5"],
                                             ["@opam/stdlib-shims",
                                             "opam:0.3.0"],
                                             ["@opam/zarith", "opam:1.12"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/astring",
  new Map([["opam:0.8.5",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__astring__opam__c__0.8.5__471b9e4a/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/astring", "opam:0.8.5"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.0"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["@opam/topkg", "opam:1.0.3"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/atd",
  new Map([["opam:2.2.1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__atd__opam__c__2.2.1__a8977c30/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/atd", "opam:2.2.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/easy-format",
                                             "opam:1.3.2"],
                                             ["@opam/menhir",
                                             "opam:20210419"],
                                             ["@opam/re", "opam:1.9.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/atdgen",
  new Map([["opam:2.2.1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__atdgen__opam__c__2.2.1__abe64188/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/atd", "opam:2.2.1"],
                                             ["@opam/atdgen", "opam:2.2.1"],
                                             ["@opam/atdgen-runtime",
                                             "opam:2.2.1"],
                                             ["@opam/biniou", "opam:1.2.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/yojson", "opam:1.7.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/atdgen-runtime",
  new Map([["opam:2.2.1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__atdgen_runtime__opam__c__2.2.1__f0510768/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/atdgen-runtime",
                                             "opam:2.2.1"],
                                             ["@opam/biniou", "opam:1.2.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/re", "opam:1.9.0"],
                                             ["@opam/yojson", "opam:1.7.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/base",
  new Map([["opam:v0.14.1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__base__opam__c__v0.14.1__e2aa1e81/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.14.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/dune-configurator",
                                             "opam:2.9.0"],
                                             ["@opam/sexplib0",
                                             "opam:v0.14.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/base-bytes",
  new Map([["opam:base",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__base_bytes__opam__c__base__48b6019a/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-bytes",
                                             "opam:base"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/base-threads",
  new Map([["opam:base",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__base_threads__opam__c__base__f282958b/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-threads",
                                             "opam:base"]])}]])],
  ["@opam/base-unix",
  new Map([["opam:base",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__base_unix__opam__c__base__93427a57/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-unix", "opam:base"]])}]])],
  ["@opam/base64",
  new Map([["opam:3.5.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__base64__opam__c__3.5.0__7cc64a98/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base64", "opam:3.5.0"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/base_bigstring",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__base__bigstring__opam__c__v0.14.0__19ef1c8b/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.14.1"],
                                             ["@opam/base_bigstring",
                                             "opam:v0.14.0"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ppx_jane",
                                             "opam:v0.14.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/base_quickcheck",
  new Map([["opam:v0.14.1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__base__quickcheck__opam__c__v0.14.1__c20699fe/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.14.1"],
                                             ["@opam/base_quickcheck",
                                             "opam:v0.14.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ppx_base",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_fields_conv",
                                             "opam:v0.14.2"],
                                             ["@opam/ppx_let",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_sexp_message",
                                             "opam:v0.14.1"],
                                             ["@opam/ppx_sexp_value",
                                             "opam:v0.14.0"],
                                             ["@opam/ppxlib", "opam:0.22.2"],
                                             ["@opam/splittable_random",
                                             "opam:v0.14.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/bigarray-compat",
  new Map([["opam:1.0.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__bigarray_compat__opam__c__1.0.0__85f431b8/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/bigarray-compat",
                                             "opam:1.0.0"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/bignum",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__bignum__opam__c__v0.14.0__1489ae6f/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/bignum", "opam:v0.14.0"],
                                             ["@opam/core_kernel",
                                             "opam:v0.14.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/num", "opam:1.4"],
                                             ["@opam/ppx_jane",
                                             "opam:v0.14.0"],
                                             ["@opam/splittable_random",
                                             "opam:v0.14.0"],
                                             ["@opam/typerep",
                                             "opam:v0.14.0"],
                                             ["@opam/zarith", "opam:1.12"],
                                             ["@opam/zarith_stubs_js",
                                             "opam:v0.14.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/bigstringaf",
  new Map([["opam:0.8.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__bigstringaf__opam__c__0.8.0__e5d3dc84/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/bigarray-compat",
                                             "opam:1.0.0"],
                                             ["@opam/bigstringaf",
                                             "opam:0.8.0"],
                                             ["@opam/conf-pkg-config",
                                             "opam:2"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/bin_prot",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__bin__prot__opam__c__v0.14.0__149bb2af/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.14.1"],
                                             ["@opam/bin_prot",
                                             "opam:v0.14.0"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ppx_compare",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_custom_printf",
                                             "opam:v0.14.1"],
                                             ["@opam/ppx_fields_conv",
                                             "opam:v0.14.2"],
                                             ["@opam/ppx_optcomp",
                                             "opam:v0.14.2"],
                                             ["@opam/ppx_sexp_conv",
                                             "opam:v0.14.3"],
                                             ["@opam/ppx_variants_conv",
                                             "opam:v0.14.1"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/biniou",
  new Map([["opam:1.2.1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__biniou__opam__c__1.2.1__9a37384b/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/biniou", "opam:1.2.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/easy-format",
                                             "opam:1.3.2"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/bos",
  new Map([["opam:0.2.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__bos__opam__c__0.2.0__27475d3e/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/astring", "opam:0.8.5"],
                                             ["@opam/base-unix", "opam:base"],
                                             ["@opam/bos", "opam:0.2.0"],
                                             ["@opam/fmt", "opam:0.8.9"],
                                             ["@opam/fpath", "opam:0.7.3"],
                                             ["@opam/logs", "opam:0.7.0"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.0"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["@opam/rresult", "opam:0.6.0"],
                                             ["@opam/topkg", "opam:1.0.3"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ca-certs",
  new Map([["opam:0.2.1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ca_certs__opam__c__0.2.1__c4d9849d/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/astring", "opam:0.8.5"],
                                             ["@opam/bos", "opam:0.2.0"],
                                             ["@opam/ca-certs", "opam:0.2.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/fpath", "opam:0.7.3"],
                                             ["@opam/logs", "opam:0.7.0"],
                                             ["@opam/mirage-crypto",
                                             "opam:0.10.3"],
                                             ["@opam/ptime", "opam:0.8.5"],
                                             ["@opam/rresult", "opam:0.6.0"],
                                             ["@opam/x509", "opam:0.14.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/caqti",
  new Map([["opam:1.6.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__caqti__opam__c__1.6.0__b891f183/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/caqti", "opam:1.6.0"],
                                             ["@opam/cppo", "opam:1.6.7"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/logs", "opam:0.7.0"],
                                             ["@opam/ptime", "opam:0.8.5"],
                                             ["@opam/uri", "opam:4.2.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/caqti-driver-postgresql",
  new Map([["opam:1.6.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__caqti_driver_postgresql__opam__c__1.6.0__8fc6a95a/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/caqti", "opam:1.6.0"],
                                             ["@opam/caqti-driver-postgresql",
                                             "opam:1.6.0"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/postgresql",
                                             "opam:5.0.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/caqti-lwt",
  new Map([["opam:1.6.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__caqti_lwt__opam__c__1.6.0__0351158a/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/caqti", "opam:1.6.0"],
                                             ["@opam/caqti-lwt",
                                             "opam:1.6.0"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/logs", "opam:0.7.0"],
                                             ["@opam/lwt", "opam:5.4.1"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/cmdliner",
  new Map([["opam:1.0.4",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__cmdliner__opam__c__1.0.4__11482f41/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/cmdliner", "opam:1.0.4"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/cohttp",
  new Map([["opam:4.0.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__cohttp__opam__c__4.0.0__9d317795/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base64", "opam:3.5.0"],
                                             ["@opam/cohttp", "opam:4.0.0"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/jsonm", "opam:1.0.1"],
                                             ["@opam/ppx_sexp_conv",
                                             "opam:v0.14.3"],
                                             ["@opam/re", "opam:1.9.0"],
                                             ["@opam/sexplib0",
                                             "opam:v0.14.0"],
                                             ["@opam/stringext",
                                             "opam:1.6.0"],
                                             ["@opam/uri", "opam:4.2.0"],
                                             ["@opam/uri-sexp", "opam:4.2.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/cohttp-lwt",
  new Map([["opam:4.0.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__cohttp_lwt__opam__c__4.0.0__b9ddef0a/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/cohttp", "opam:4.0.0"],
                                             ["@opam/cohttp-lwt",
                                             "opam:4.0.0"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/logs", "opam:0.7.0"],
                                             ["@opam/lwt", "opam:5.4.1"],
                                             ["@opam/ppx_sexp_conv",
                                             "opam:v0.14.3"],
                                             ["@opam/sexplib0",
                                             "opam:v0.14.0"],
                                             ["@opam/uri", "opam:4.2.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/cohttp-lwt-unix",
  new Map([["opam:4.0.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__cohttp_lwt_unix__opam__c__4.0.0__374d37db/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-unix", "opam:base"],
                                             ["@opam/cmdliner", "opam:1.0.4"],
                                             ["@opam/cohttp-lwt",
                                             "opam:4.0.0"],
                                             ["@opam/cohttp-lwt-unix",
                                             "opam:4.0.0"],
                                             ["@opam/conduit-lwt",
                                             "opam:4.0.0"],
                                             ["@opam/conduit-lwt-unix",
                                             "opam:4.0.0"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/fmt", "opam:0.8.9"],
                                             ["@opam/logs", "opam:0.7.0"],
                                             ["@opam/lwt", "opam:5.4.1"],
                                             ["@opam/magic-mime",
                                             "opam:1.2.0"],
                                             ["@opam/ppx_sexp_conv",
                                             "opam:v0.14.3"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/conduit",
  new Map([["opam:4.0.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__conduit__opam__c__4.0.0__0bc07767/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/astring", "opam:0.8.5"],
                                             ["@opam/conduit", "opam:4.0.0"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ipaddr", "opam:5.1.0"],
                                             ["@opam/ipaddr-sexp",
                                             "opam:5.1.0"],
                                             ["@opam/logs", "opam:0.7.0"],
                                             ["@opam/ppx_sexp_conv",
                                             "opam:v0.14.3"],
                                             ["@opam/sexplib",
                                             "opam:v0.14.0"],
                                             ["@opam/uri", "opam:4.2.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/conduit-lwt",
  new Map([["opam:4.0.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__conduit_lwt__opam__c__4.0.0__17b83ca9/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-unix", "opam:base"],
                                             ["@opam/conduit", "opam:4.0.0"],
                                             ["@opam/conduit-lwt",
                                             "opam:4.0.0"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/lwt", "opam:5.4.1"],
                                             ["@opam/ppx_sexp_conv",
                                             "opam:v0.14.3"],
                                             ["@opam/sexplib",
                                             "opam:v0.14.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/conduit-lwt-unix",
  new Map([["opam:4.0.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__conduit_lwt_unix__opam__c__4.0.0__d2be4fba/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-unix", "opam:base"],
                                             ["@opam/ca-certs", "opam:0.2.1"],
                                             ["@opam/conduit-lwt",
                                             "opam:4.0.0"],
                                             ["@opam/conduit-lwt-unix",
                                             "opam:4.0.0"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ipaddr", "opam:5.1.0"],
                                             ["@opam/ipaddr-sexp",
                                             "opam:5.1.0"],
                                             ["@opam/logs", "opam:0.7.0"],
                                             ["@opam/lwt", "opam:5.4.1"],
                                             ["@opam/ppx_sexp_conv",
                                             "opam:v0.14.3"],
                                             ["@opam/uri", "opam:4.2.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/conf-gmp",
  new Map([["opam:3",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__conf_gmp__opam__c__3__9642db88/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/conf-gmp", "opam:3"],
                                             ["esy-gmp",
                                             "archive:https://gmplib.org/download/gmp/gmp-6.2.1.tar.xz#sha1:0578d48607ec0e272177d175fd1807c30b00fdf2"]])}]])],
  ["@opam/conf-gmp-powm-sec",
  new Map([["opam:3",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__conf_gmp_powm_sec__opam__c__3__0ac687f9/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/conf-gmp", "opam:3"],
                                             ["@opam/conf-gmp-powm-sec",
                                             "opam:3"]])}]])],
  ["@opam/conf-libffi",
  new Map([["opam:2.0.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__conf_libffi__opam__c__2.0.0__e563ab65/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/conf-libffi",
                                             "opam:2.0.0"],
                                             ["@opam/conf-pkg-config",
                                             "opam:2"],
                                             ["esy-libffi",
                                             "github:esy-ocaml/libffi#c61127dba57b18713039ab9c1892c9f2563e280c"]])}]])],
  ["@opam/conf-libpcre",
  new Map([["opam:1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__conf_libpcre__opam__c__1__4441479f/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/conf-libpcre", "opam:1"],
                                             ["@opam/conf-pkg-config",
                                             "opam:2"],
                                             ["esy-pcre",
                                             "github:esy-packages/esy-pcre#c5076c8facbebaf5f5718c0e270418fd218add7e"]])}]])],
  ["@opam/conf-m4",
  new Map([["opam:1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__conf_m4__opam__c__1__ecdf46a3/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/conf-m4", "opam:1"],
                                             ["esy-m4",
                                             "github:esy-packages/esy-m4#c7cf0ac9221be2b1f9d90e83559ca08397a629e7"]])}]])],
  ["@opam/conf-pkg-config",
  new Map([["opam:2",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__conf_pkg_config__opam__c__2__f94434f0/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/conf-pkg-config",
                                             "opam:2"],
                                             ["yarn-pkg-config",
                                             "github:esy-ocaml/yarn-pkg-config#db3a0b63883606dd57c54a7158d560d6cba8cd79"]])}]])],
  ["@opam/conf-postgresql",
  new Map([["opam:1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__conf_postgresql__opam__c__1__574941d3/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/conf-postgresql",
                                             "opam:1"]])}]])],
  ["@opam/core",
  new Map([["opam:v0.14.1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__core__opam__c__v0.14.1__1b64200c/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-threads",
                                             "opam:base"],
                                             ["@opam/core", "opam:v0.14.1"],
                                             ["@opam/core_kernel",
                                             "opam:v0.14.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/jst-config",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_jane",
                                             "opam:v0.14.0"],
                                             ["@opam/sexplib",
                                             "opam:v0.14.0"],
                                             ["@opam/spawn", "opam:v0.13.0"],
                                             ["@opam/timezone",
                                             "opam:v0.14.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/core_kernel",
  new Map([["opam:v0.14.1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__core__kernel__opam__c__v0.14.1__270ab316/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.14.1"],
                                             ["@opam/base_bigstring",
                                             "opam:v0.14.0"],
                                             ["@opam/base_quickcheck",
                                             "opam:v0.14.1"],
                                             ["@opam/bin_prot",
                                             "opam:v0.14.0"],
                                             ["@opam/core_kernel",
                                             "opam:v0.14.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/fieldslib",
                                             "opam:v0.14.0"],
                                             ["@opam/jane-street-headers",
                                             "opam:v0.14.0"],
                                             ["@opam/jst-config",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_assert",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_base",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_hash",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_inline_test",
                                             "opam:v0.14.1"],
                                             ["@opam/ppx_jane",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_sexp_conv",
                                             "opam:v0.14.3"],
                                             ["@opam/ppx_sexp_message",
                                             "opam:v0.14.1"],
                                             ["@opam/sexplib",
                                             "opam:v0.14.0"],
                                             ["@opam/splittable_random",
                                             "opam:v0.14.0"],
                                             ["@opam/stdio", "opam:v0.14.0"],
                                             ["@opam/time_now",
                                             "opam:v0.14.0"],
                                             ["@opam/typerep",
                                             "opam:v0.14.0"],
                                             ["@opam/variantslib",
                                             "opam:v0.14.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/cppo",
  new Map([["opam:1.6.7",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__cppo__opam__c__1.6.7__6c77bc8a/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-unix", "opam:base"],
                                             ["@opam/cppo", "opam:1.6.7"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/csexp",
  new Map([["opam:1.5.1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__csexp__opam__c__1.5.1__a5d42d7e/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/csexp", "opam:1.5.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/cstruct",
  new Map([["opam:6.0.1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__cstruct__opam__c__6.0.1__5cf69c9a/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/bigarray-compat",
                                             "opam:1.0.0"],
                                             ["@opam/cstruct", "opam:6.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ctypes",
  new Map([["opam:0.19.1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ctypes__opam__c__0.19.1__f77bd3a9/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/bigarray-compat",
                                             "opam:1.0.0"],
                                             ["@opam/ctypes", "opam:0.19.1"],
                                             ["@opam/ctypes-foreign",
                                             "opam:0.18.0"],
                                             ["@opam/integers", "opam:0.4.0"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ctypes-foreign",
  new Map([["opam:0.18.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ctypes_foreign__opam__c__0.18.0__6ebdb64b/",
             packageDependencies: new Map([["@esy-ocaml/libffi", "3.2.10"],
                                             ["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/conf-libffi",
                                             "opam:2.0.0"],
                                             ["@opam/conf-pkg-config",
                                             "opam:2"],
                                             ["@opam/ctypes-foreign",
                                             "opam:0.18.0"]])}]])],
  ["@opam/domain-name",
  new Map([["opam:0.3.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__domain_name__opam__c__0.3.0__212a23e1/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/astring", "opam:0.8.5"],
                                             ["@opam/domain-name",
                                             "opam:0.3.0"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/fmt", "opam:0.8.9"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/dot-merlin-reader",
  new Map([["opam:4.1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__dot_merlin_reader__opam__c__4.1__e3b8bf05/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/csexp", "opam:1.5.1"],
                                             ["@opam/dot-merlin-reader",
                                             "opam:4.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["@opam/result", "opam:1.5"],
                                             ["@opam/yojson", "opam:1.7.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/dotenv",
  new Map([["opam:0.0.3",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__dotenv__opam__c__0.0.3__06c1acff/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.14.1"],
                                             ["@opam/dotenv", "opam:0.0.3"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/pcre", "opam:7.5.0"],
                                             ["@opam/stdio", "opam:v0.14.0"],
                                             ["@opam/uutf", "opam:1.0.2"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/dune",
  new Map([["opam:2.9.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__dune__opam__c__2.9.0__f2432484/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-threads",
                                             "opam:base"],
                                             ["@opam/base-unix", "opam:base"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ocamlfind-secondary",
                                             "opam:1.8.1"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/dune-action-plugin",
  new Map([["opam:2.9.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__dune_action_plugin__opam__c__2.9.0__7cae86f4/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/dune-action-plugin",
                                             "opam:2.9.0"],
                                             ["@opam/dune-glob",
                                             "opam:2.9.0"],
                                             ["@opam/dune-private-libs",
                                             "opam:2.9.0"]])}]])],
  ["@opam/dune-build-info",
  new Map([["opam:2.9.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__dune_build_info__opam__c__2.9.0__cee778ca/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/dune-build-info",
                                             "opam:2.9.0"]])}]])],
  ["@opam/dune-configurator",
  new Map([["opam:2.9.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__dune_configurator__opam__c__2.9.0__fa79c0c2/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/csexp", "opam:1.5.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/dune-configurator",
                                             "opam:2.9.0"],
                                             ["@opam/result", "opam:1.5"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/dune-glob",
  new Map([["opam:2.9.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__dune_glob__opam__c__2.9.0__7d6b88c0/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/dune-glob",
                                             "opam:2.9.0"],
                                             ["@opam/dune-private-libs",
                                             "opam:2.9.0"]])}]])],
  ["@opam/dune-private-libs",
  new Map([["opam:2.9.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__dune_private_libs__opam__c__2.9.0__bfae01d9/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/dune-private-libs",
                                             "opam:2.9.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/duration",
  new Map([["opam:0.1.3",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__duration__opam__c__0.1.3__dcb75b2f/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/duration", "opam:0.1.3"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/easy-format",
  new Map([["opam:1.3.2",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__easy_format__opam__c__1.3.2__2be19d18/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/easy-format",
                                             "opam:1.3.2"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/eqaf",
  new Map([["opam:0.7",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__eqaf__opam__c__0.7__032806f7/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/bigarray-compat",
                                             "opam:1.0.0"],
                                             ["@opam/cstruct", "opam:6.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/eqaf", "opam:0.7"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ezjsonm",
  new Map([["opam:1.1.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ezjsonm__opam__c__1.1.0__14840b09/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ezjsonm", "opam:1.1.0"],
                                             ["@opam/hex", "opam:1.4.0"],
                                             ["@opam/jsonm", "opam:1.0.1"],
                                             ["@opam/sexplib",
                                             "opam:v0.14.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/faraday",
  new Map([["opam:0.8.1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__faraday__opam__c__0.8.1__284f95ca/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/bigstringaf",
                                             "opam:0.8.0"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/faraday", "opam:0.8.1"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/fieldslib",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__fieldslib__opam__c__v0.14.0__63238cb4/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.14.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/fieldslib",
                                             "opam:v0.14.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/fix",
  new Map([["opam:20201120",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__fix__opam__c__20201120__6248fa10/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/fix", "opam:20201120"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/fmt",
  new Map([["opam:0.8.9",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__fmt__opam__c__0.8.9__dfac8787/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-unix", "opam:base"],
                                             ["@opam/cmdliner", "opam:1.0.4"],
                                             ["@opam/fmt", "opam:0.8.9"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.0"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["@opam/seq", "opam:base"],
                                             ["@opam/stdlib-shims",
                                             "opam:0.3.0"],
                                             ["@opam/topkg", "opam:1.0.3"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/fpath",
  new Map([["opam:0.7.3",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__fpath__opam__c__0.7.3__18652e33/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/astring", "opam:0.8.5"],
                                             ["@opam/fpath", "opam:0.7.3"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.0"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["@opam/topkg", "opam:1.0.3"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/gmap",
  new Map([["opam:0.3.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__gmap__opam__c__0.3.0__4ff017bd/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/gmap", "opam:0.3.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/hex",
  new Map([["opam:1.4.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__hex__opam__c__1.4.0__5566ecb7/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/bigarray-compat",
                                             "opam:1.0.0"],
                                             ["@opam/cstruct", "opam:6.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/hex", "opam:1.4.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/hmap",
  new Map([["opam:0.8.1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__hmap__opam__c__0.8.1__f8cac8ba/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/hmap", "opam:0.8.1"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.0"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["@opam/topkg", "opam:1.0.3"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/httpaf",
  new Map([["opam:0.7.1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__httpaf__opam__c__0.7.1__7d1eed9b/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/angstrom",
                                             "opam:0.15.0"],
                                             ["@opam/bigstringaf",
                                             "opam:0.8.0"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/faraday", "opam:0.8.1"],
                                             ["@opam/httpaf", "opam:0.7.1"],
                                             ["@opam/result", "opam:1.5"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/integers",
  new Map([["opam:0.4.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__integers__opam__c__0.4.0__c621597f/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/integers", "opam:0.4.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ipaddr",
  new Map([["opam:5.1.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ipaddr__opam__c__5.1.0__45f4ce67/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/domain-name",
                                             "opam:0.3.0"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ipaddr", "opam:5.1.0"],
                                             ["@opam/macaddr", "opam:5.1.0"],
                                             ["@opam/stdlib-shims",
                                             "opam:0.3.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ipaddr-sexp",
  new Map([["opam:5.1.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ipaddr_sexp__opam__c__5.1.0__cbc93317/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ipaddr", "opam:5.1.0"],
                                             ["@opam/ipaddr-sexp",
                                             "opam:5.1.0"],
                                             ["@opam/ppx_sexp_conv",
                                             "opam:v0.14.3"],
                                             ["@opam/sexplib0",
                                             "opam:v0.14.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/jane-street-headers",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__jane_street_headers__opam__c__v0.14.0__2ed620b8/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/jane-street-headers",
                                             "opam:v0.14.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/jsonm",
  new Map([["opam:1.0.1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__jsonm__opam__c__1.0.1__0f41f896/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/jsonm", "opam:1.0.1"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.0"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["@opam/topkg", "opam:1.0.3"],
                                             ["@opam/uchar", "opam:0.0.2"],
                                             ["@opam/uutf", "opam:1.0.2"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/jst-config",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__jst_config__opam__c__v0.14.0__8538ee8e/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.14.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/dune-configurator",
                                             "opam:2.9.0"],
                                             ["@opam/jst-config",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_assert",
                                             "opam:v0.14.0"],
                                             ["@opam/stdio", "opam:v0.14.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/logs",
  new Map([["opam:0.7.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__logs__opam__c__0.7.0__cf15da05/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-threads",
                                             "opam:base"],
                                             ["@opam/cmdliner", "opam:1.0.4"],
                                             ["@opam/fmt", "opam:0.8.9"],
                                             ["@opam/logs", "opam:0.7.0"],
                                             ["@opam/lwt", "opam:5.4.1"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.0"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["@opam/topkg", "opam:1.0.3"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/lwt",
  new Map([["opam:5.4.1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__lwt__opam__c__5.4.1__9dd6ef09/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-threads",
                                             "opam:base"],
                                             ["@opam/base-unix", "opam:base"],
                                             ["@opam/cppo", "opam:1.6.7"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/dune-configurator",
                                             "opam:2.9.0"],
                                             ["@opam/lwt", "opam:5.4.1"],
                                             ["@opam/mmap", "opam:1.1.0"],
                                             ["@opam/ocaml-syntax-shims",
                                             "opam:1.0.0"],
                                             ["@opam/ocplib-endian",
                                             "opam:1.1"],
                                             ["@opam/result", "opam:1.5"],
                                             ["@opam/seq", "opam:base"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/lwt_log",
  new Map([["opam:1.1.1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__lwt__log__opam__c__1.1.1__7f54b5d1/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/lwt", "opam:5.4.1"],
                                             ["@opam/lwt_log", "opam:1.1.1"]])}]])],
  ["@opam/lwt_ppx",
  new Map([["opam:2.0.2",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__lwt__ppx__opam__c__2.0.2__49533d10/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/lwt", "opam:5.4.1"],
                                             ["@opam/lwt_ppx", "opam:2.0.2"],
                                             ["@opam/ppxlib", "opam:0.22.2"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/macaddr",
  new Map([["opam:5.1.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__macaddr__opam__c__5.1.0__567b7407/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/macaddr", "opam:5.1.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/magic-mime",
  new Map([["opam:1.2.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__magic_mime__opam__c__1.2.0__c9733c05/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/magic-mime",
                                             "opam:1.2.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/melange-compiler-libs",
  new Map([["github:melange-re/melange-compiler-libs:melange-compiler-libs.opam#c787d2f98a",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__melange_compiler_libs__5ee7bd99/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/melange-compiler-libs",
                                             "github:melange-re/melange-compiler-libs:melange-compiler-libs.opam#c787d2f98a"],
                                             ["@opam/menhir",
                                             "opam:20210419"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/menhir",
  new Map([["opam:20210419",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__menhir__opam__c__20210419__ee825b3c/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/menhir",
                                             "opam:20210419"],
                                             ["@opam/menhirLib",
                                             "opam:20210419"],
                                             ["@opam/menhirSdk",
                                             "opam:20210419"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/menhirLib",
  new Map([["opam:20210419",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__menhirlib__opam__c__20210419__61564494/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/menhirLib",
                                             "opam:20210419"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/menhirSdk",
  new Map([["opam:20210419",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__menhirsdk__opam__c__20210419__3462be48/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/menhirSdk",
                                             "opam:20210419"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/merlin-extend",
  new Map([["opam:0.6",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__merlin_extend__opam__c__0.6__4a4028a6/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/cppo", "opam:1.6.7"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/merlin-extend",
                                             "opam:0.6"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/mirage-crypto",
  new Map([["opam:0.10.3",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__mirage_crypto__opam__c__0.10.3__0a26ec5a/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/bigarray-compat",
                                             "opam:1.0.0"],
                                             ["@opam/conf-pkg-config",
                                             "opam:2"],
                                             ["@opam/cstruct", "opam:6.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/dune-configurator",
                                             "opam:2.9.0"],
                                             ["@opam/eqaf", "opam:0.7"],
                                             ["@opam/mirage-crypto",
                                             "opam:0.10.3"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/mirage-crypto-ec",
  new Map([["opam:0.10.3",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__mirage_crypto_ec__opam__c__0.10.3__ccea7be3/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/conf-pkg-config",
                                             "opam:2"],
                                             ["@opam/cstruct", "opam:6.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/dune-configurator",
                                             "opam:2.9.0"],
                                             ["@opam/eqaf", "opam:0.7"],
                                             ["@opam/mirage-crypto",
                                             "opam:0.10.3"],
                                             ["@opam/mirage-crypto-ec",
                                             "opam:0.10.3"],
                                             ["@opam/mirage-crypto-rng",
                                             "opam:0.10.3"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/mirage-crypto-pk",
  new Map([["opam:0.10.3",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__mirage_crypto_pk__opam__c__0.10.3__4de1d181/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/conf-gmp-powm-sec",
                                             "opam:3"],
                                             ["@opam/cstruct", "opam:6.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/eqaf", "opam:0.7"],
                                             ["@opam/mirage-crypto",
                                             "opam:0.10.3"],
                                             ["@opam/mirage-crypto-pk",
                                             "opam:0.10.3"],
                                             ["@opam/mirage-crypto-rng",
                                             "opam:0.10.3"],
                                             ["@opam/mirage-no-solo5",
                                             "opam:1"],
                                             ["@opam/mirage-no-xen",
                                             "opam:1"],
                                             ["@opam/ppx_sexp_conv",
                                             "opam:v0.14.3"],
                                             ["@opam/rresult", "opam:0.6.0"],
                                             ["@opam/sexplib",
                                             "opam:v0.14.0"],
                                             ["@opam/zarith", "opam:1.12"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/mirage-crypto-rng",
  new Map([["opam:0.10.3",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__mirage_crypto_rng__opam__c__0.10.3__00ea5b06/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/cstruct", "opam:6.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/dune-configurator",
                                             "opam:2.9.0"],
                                             ["@opam/duration", "opam:0.1.3"],
                                             ["@opam/logs", "opam:0.7.0"],
                                             ["@opam/lwt", "opam:5.4.1"],
                                             ["@opam/mirage-crypto",
                                             "opam:0.10.3"],
                                             ["@opam/mirage-crypto-rng",
                                             "opam:0.10.3"],
                                             ["@opam/mtime", "opam:1.2.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/mirage-no-solo5",
  new Map([["opam:1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__mirage_no_solo5__opam__c__1__0dfe7436/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/mirage-no-solo5",
                                             "opam:1"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/mirage-no-xen",
  new Map([["opam:1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__mirage_no_xen__opam__c__1__5b4fa424/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/mirage-no-xen",
                                             "opam:1"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/mmap",
  new Map([["opam:1.1.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__mmap__opam__c__1.1.0__2cba59f8/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/mmap", "opam:1.1.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/mtime",
  new Map([["opam:1.2.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__mtime__opam__c__1.2.0__a4b0f312/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/mtime", "opam:1.2.0"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.0"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["@opam/topkg", "opam:1.0.3"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/num",
  new Map([["opam:1.4",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__num__opam__c__1.4__80adde80/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/num", "opam:1.4"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ocaml-compiler-libs",
  new Map([["opam:v0.12.3",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ocaml_compiler_libs__opam__c__v0.12.3__777e40be/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ocaml-compiler-libs",
                                             "opam:v0.12.3"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ocaml-lsp-server",
  new Map([["opam:1.7.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ocaml_lsp_server__opam__c__1.7.0__8dd35f22/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/csexp", "opam:1.5.1"],
                                             ["@opam/dot-merlin-reader",
                                             "opam:4.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/dune-build-info",
                                             "opam:2.9.0"],
                                             ["@opam/ocaml-lsp-server",
                                             "opam:1.7.0"],
                                             ["@opam/pp", "opam:1.1.2"],
                                             ["@opam/ppx_yojson_conv_lib",
                                             "opam:v0.14.0"],
                                             ["@opam/re", "opam:1.9.0"],
                                             ["@opam/result", "opam:1.5"],
                                             ["@opam/yojson", "opam:1.7.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ocaml-migrate-parsetree",
  new Map([["opam:2.2.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ocaml_migrate_parsetree__opam__c__2.2.0__f0755492/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ocaml-migrate-parsetree",
                                             "opam:2.2.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ocaml-secondary-compiler",
  new Map([["opam:4.08.1-1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ocaml_secondary_compiler__opam__c__4.08.1_1__d0da7c19/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/ocaml-secondary-compiler",
                                             "opam:4.08.1-1"]])}]])],
  ["@opam/ocaml-syntax-shims",
  new Map([["opam:1.0.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ocaml_syntax_shims__opam__c__1.0.0__cb8d5a09/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ocaml-syntax-shims",
                                             "opam:1.0.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ocamlbuild",
  new Map([["opam:0.14.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ocamlbuild__opam__c__0.14.0__aff6a0b0/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ocamlfind",
  new Map([["opam:1.8.1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ocamlfind__opam__c__1.8.1__ab68a5ee/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/conf-m4", "opam:1"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ocamlfind-secondary",
  new Map([["opam:1.8.1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ocamlfind_secondary__opam__c__1.8.1__0797ff08/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/ocaml-secondary-compiler",
                                             "opam:4.08.1-1"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["@opam/ocamlfind-secondary",
                                             "opam:1.8.1"]])}]])],
  ["@opam/ocplib-endian",
  new Map([["opam:1.1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ocplib_endian__opam__c__1.1__729a5869/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-bytes",
                                             "opam:base"],
                                             ["@opam/cppo", "opam:1.6.7"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ocplib-endian",
                                             "opam:1.1"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/octavius",
  new Map([["opam:1.2.2",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__octavius__opam__c__1.2.2__96807fc5/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/octavius", "opam:1.2.2"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/opium",
  new Map([["opam:0.17.1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__opium__opam__c__0.17.1__5de99d51/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-unix", "opam:base"],
                                             ["@opam/cmdliner", "opam:1.0.4"],
                                             ["@opam/cohttp-lwt-unix",
                                             "opam:4.0.0"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/logs", "opam:0.7.0"],
                                             ["@opam/lwt", "opam:5.4.1"],
                                             ["@opam/magic-mime",
                                             "opam:1.2.0"],
                                             ["@opam/opium", "opam:0.17.1"],
                                             ["@opam/opium_kernel",
                                             "opam:0.17.1"],
                                             ["@opam/ppx_fields_conv",
                                             "opam:v0.14.2"],
                                             ["@opam/ppx_sexp_conv",
                                             "opam:v0.14.3"],
                                             ["@opam/re", "opam:1.9.0"],
                                             ["@opam/stringext",
                                             "opam:1.6.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/opium_kernel",
  new Map([["opam:0.17.1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__opium__kernel__opam__c__0.17.1__56b6d155/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base64", "opam:3.5.0"],
                                             ["@opam/cohttp", "opam:4.0.0"],
                                             ["@opam/cohttp-lwt",
                                             "opam:4.0.0"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ezjsonm", "opam:1.1.0"],
                                             ["@opam/fieldslib",
                                             "opam:v0.14.0"],
                                             ["@opam/hmap", "opam:0.8.1"],
                                             ["@opam/lwt", "opam:5.4.1"],
                                             ["@opam/opium_kernel",
                                             "opam:0.17.1"],
                                             ["@opam/ppx_fields_conv",
                                             "opam:v0.14.2"],
                                             ["@opam/ppx_sexp_conv",
                                             "opam:v0.14.3"],
                                             ["@opam/re", "opam:1.9.0"],
                                             ["@opam/sexplib",
                                             "opam:v0.14.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/parsexp",
  new Map([["opam:v0.14.1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__parsexp__opam__c__v0.14.1__051ca407/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.14.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/parsexp",
                                             "opam:v0.14.1"],
                                             ["@opam/sexplib0",
                                             "opam:v0.14.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/pbkdf",
  new Map([["opam:1.1.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__pbkdf__opam__c__1.1.0__0f31f372/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/mirage-crypto",
                                             "opam:0.10.3"],
                                             ["@opam/pbkdf", "opam:1.1.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/pcre",
  new Map([["opam:7.5.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__pcre__opam__c__7.5.0__08b3a44f/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-bytes",
                                             "opam:base"],
                                             ["@opam/conf-libpcre", "opam:1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/dune-configurator",
                                             "opam:2.9.0"],
                                             ["@opam/pcre", "opam:7.5.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/pg_query",
  new Map([["opam:0.9.7",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__pg__query__opam__c__0.9.7__eba2497d/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/cmdliner", "opam:1.0.4"],
                                             ["@opam/ctypes", "opam:0.19.1"],
                                             ["@opam/ctypes-foreign",
                                             "opam:0.18.0"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/pg_query", "opam:0.9.7"],
                                             ["@opam/ppx_deriving",
                                             "opam:5.2.1"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/postgresql",
  new Map([["opam:5.0.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__postgresql__opam__c__5.0.0__1fd0f07a/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-bytes",
                                             "opam:base"],
                                             ["@opam/conf-postgresql",
                                             "opam:1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/dune-configurator",
                                             "opam:2.9.0"],
                                             ["@opam/postgresql",
                                             "opam:5.0.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/pp",
  new Map([["opam:1.1.2",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__pp__opam__c__1.1.2__ebad31ff/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/pp", "opam:1.1.2"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ppx_assert",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ppx__assert__opam__c__v0.14.0__41578bf1/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.14.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ppx_assert",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_cold",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_compare",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_here",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_sexp_conv",
                                             "opam:v0.14.3"],
                                             ["@opam/ppxlib", "opam:0.22.2"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ppx_base",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ppx__base__opam__c__v0.14.0__69130302/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ppx_base",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_cold",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_compare",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_enumerate",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_hash",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_js_style",
                                             "opam:v0.14.1"],
                                             ["@opam/ppx_sexp_conv",
                                             "opam:v0.14.3"],
                                             ["@opam/ppxlib", "opam:0.22.2"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ppx_bench",
  new Map([["opam:v0.14.1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ppx__bench__opam__c__v0.14.1__0150ca22/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ppx_bench",
                                             "opam:v0.14.1"],
                                             ["@opam/ppx_inline_test",
                                             "opam:v0.14.1"],
                                             ["@opam/ppxlib", "opam:0.22.2"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ppx_bin_prot",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ppx__bin__prot__opam__c__v0.14.0__ee186529/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.14.1"],
                                             ["@opam/bin_prot",
                                             "opam:v0.14.0"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ppx_bin_prot",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_here",
                                             "opam:v0.14.0"],
                                             ["@opam/ppxlib", "opam:0.22.2"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ppx_cold",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ppx__cold__opam__c__v0.14.0__20831c56/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.14.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ppx_cold",
                                             "opam:v0.14.0"],
                                             ["@opam/ppxlib", "opam:0.22.2"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ppx_compare",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ppx__compare__opam__c__v0.14.0__d8a7262e/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.14.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ppx_compare",
                                             "opam:v0.14.0"],
                                             ["@opam/ppxlib", "opam:0.22.2"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ppx_custom_printf",
  new Map([["opam:v0.14.1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ppx__custom__printf__opam__c__v0.14.1__c81a23d7/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.14.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ppx_custom_printf",
                                             "opam:v0.14.1"],
                                             ["@opam/ppx_sexp_conv",
                                             "opam:v0.14.3"],
                                             ["@opam/ppxlib", "opam:0.22.2"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ppx_derivers",
  new Map([["opam:1.2.1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ppx__derivers__opam__c__1.2.1__a5e0f03f/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ppx_derivers",
                                             "opam:1.2.1"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ppx_deriving",
  new Map([["opam:5.2.1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ppx__deriving__opam__c__5.2.1__7dc03006/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/cppo", "opam:1.6.7"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["@opam/ppx_derivers",
                                             "opam:1.2.1"],
                                             ["@opam/ppx_deriving",
                                             "opam:5.2.1"],
                                             ["@opam/ppxlib", "opam:0.22.2"],
                                             ["@opam/result", "opam:1.5"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ppx_deriving_yojson",
  new Map([["opam:3.6.1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ppx__deriving__yojson__opam__c__3.6.1__f7812344/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ppx_deriving",
                                             "opam:5.2.1"],
                                             ["@opam/ppx_deriving_yojson",
                                             "opam:3.6.1"],
                                             ["@opam/ppxlib", "opam:0.22.2"],
                                             ["@opam/result", "opam:1.5"],
                                             ["@opam/yojson", "opam:1.7.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ppx_enumerate",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ppx__enumerate__opam__c__v0.14.0__5fc8f5bc/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.14.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ppx_enumerate",
                                             "opam:v0.14.0"],
                                             ["@opam/ppxlib", "opam:0.22.2"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ppx_expect",
  new Map([["opam:v0.14.1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ppx__expect__opam__c__v0.14.1__91ba70f8/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.14.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ppx_expect",
                                             "opam:v0.14.1"],
                                             ["@opam/ppx_here",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_inline_test",
                                             "opam:v0.14.1"],
                                             ["@opam/ppxlib", "opam:0.22.2"],
                                             ["@opam/re", "opam:1.9.0"],
                                             ["@opam/stdio", "opam:v0.14.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ppx_fields_conv",
  new Map([["opam:v0.14.2",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ppx__fields__conv__opam__c__v0.14.2__1e26fc9a/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.14.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/fieldslib",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_fields_conv",
                                             "opam:v0.14.2"],
                                             ["@opam/ppxlib", "opam:0.22.2"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ppx_fixed_literal",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ppx__fixed__literal__opam__c__v0.14.0__3e956caf/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.14.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ppx_fixed_literal",
                                             "opam:v0.14.0"],
                                             ["@opam/ppxlib", "opam:0.22.2"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ppx_hash",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ppx__hash__opam__c__v0.14.0__84fc2573/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.14.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ppx_compare",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_hash",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_sexp_conv",
                                             "opam:v0.14.3"],
                                             ["@opam/ppxlib", "opam:0.22.2"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ppx_here",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ppx__here__opam__c__v0.14.0__fefd8712/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.14.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ppx_here",
                                             "opam:v0.14.0"],
                                             ["@opam/ppxlib", "opam:0.22.2"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ppx_inline_test",
  new Map([["opam:v0.14.1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ppx__inline__test__opam__c__v0.14.1__ba73c193/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.14.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ppx_inline_test",
                                             "opam:v0.14.1"],
                                             ["@opam/ppxlib", "opam:0.22.2"],
                                             ["@opam/time_now",
                                             "opam:v0.14.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ppx_jane",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ppx__jane__opam__c__v0.14.0__280af509/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base_quickcheck",
                                             "opam:v0.14.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ppx_assert",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_base",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_bench",
                                             "opam:v0.14.1"],
                                             ["@opam/ppx_bin_prot",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_custom_printf",
                                             "opam:v0.14.1"],
                                             ["@opam/ppx_expect",
                                             "opam:v0.14.1"],
                                             ["@opam/ppx_fields_conv",
                                             "opam:v0.14.2"],
                                             ["@opam/ppx_fixed_literal",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_here",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_inline_test",
                                             "opam:v0.14.1"],
                                             ["@opam/ppx_jane",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_let",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_module_timer",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_optcomp",
                                             "opam:v0.14.2"],
                                             ["@opam/ppx_optional",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_pipebang",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_sexp_message",
                                             "opam:v0.14.1"],
                                             ["@opam/ppx_sexp_value",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_stable",
                                             "opam:v0.14.1"],
                                             ["@opam/ppx_string",
                                             "opam:v0.14.1"],
                                             ["@opam/ppx_typerep_conv",
                                             "opam:v0.14.2"],
                                             ["@opam/ppx_variants_conv",
                                             "opam:v0.14.1"],
                                             ["@opam/ppxlib", "opam:0.22.2"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ppx_js_style",
  new Map([["opam:v0.14.1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ppx__js__style__opam__c__v0.14.1__927575a1/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.14.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/octavius", "opam:1.2.2"],
                                             ["@opam/ppx_js_style",
                                             "opam:v0.14.1"],
                                             ["@opam/ppxlib", "opam:0.22.2"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ppx_let",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ppx__let__opam__c__v0.14.0__61e3bda3/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.14.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ppx_let",
                                             "opam:v0.14.0"],
                                             ["@opam/ppxlib", "opam:0.22.2"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ppx_module_timer",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ppx__module__timer__opam__c__v0.14.0__bfabd415/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.14.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ppx_base",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_module_timer",
                                             "opam:v0.14.0"],
                                             ["@opam/ppxlib", "opam:0.22.2"],
                                             ["@opam/stdio", "opam:v0.14.0"],
                                             ["@opam/time_now",
                                             "opam:v0.14.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ppx_optcomp",
  new Map([["opam:v0.14.2",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ppx__optcomp__opam__c__v0.14.2__db3c8474/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.14.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ppx_optcomp",
                                             "opam:v0.14.2"],
                                             ["@opam/ppxlib", "opam:0.22.2"],
                                             ["@opam/stdio", "opam:v0.14.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ppx_optional",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ppx__optional__opam__c__v0.14.0__ea191660/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.14.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ppx_optional",
                                             "opam:v0.14.0"],
                                             ["@opam/ppxlib", "opam:0.22.2"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ppx_pipebang",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ppx__pipebang__opam__c__v0.14.0__ac4eb04b/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ppx_pipebang",
                                             "opam:v0.14.0"],
                                             ["@opam/ppxlib", "opam:0.22.2"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ppx_rapper",
  new Map([["opam:3.0.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ppx__rapper__opam__c__3.0.0__34fc2f77/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.14.1"],
                                             ["@opam/caqti", "opam:1.6.0"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/pg_query", "opam:0.9.7"],
                                             ["@opam/ppx_rapper",
                                             "opam:3.0.0"],
                                             ["@opam/ppxlib", "opam:0.22.2"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ppx_rapper_lwt",
  new Map([["opam:3.0.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ppx__rapper__lwt__opam__c__3.0.0__b5725b11/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/caqti-lwt",
                                             "opam:1.6.0"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/lwt", "opam:5.4.1"],
                                             ["@opam/ppx_rapper",
                                             "opam:3.0.0"],
                                             ["@opam/ppx_rapper_lwt",
                                             "opam:3.0.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ppx_sexp_conv",
  new Map([["opam:v0.14.3",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ppx__sexp__conv__opam__c__v0.14.3__c785b6cc/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.14.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ppx_sexp_conv",
                                             "opam:v0.14.3"],
                                             ["@opam/ppxlib", "opam:0.22.2"],
                                             ["@opam/sexplib0",
                                             "opam:v0.14.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ppx_sexp_message",
  new Map([["opam:v0.14.1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ppx__sexp__message__opam__c__v0.14.1__a4755916/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.14.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ppx_here",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_sexp_conv",
                                             "opam:v0.14.3"],
                                             ["@opam/ppx_sexp_message",
                                             "opam:v0.14.1"],
                                             ["@opam/ppxlib", "opam:0.22.2"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ppx_sexp_value",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ppx__sexp__value__opam__c__v0.14.0__6e0ebda3/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.14.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ppx_here",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_sexp_conv",
                                             "opam:v0.14.3"],
                                             ["@opam/ppx_sexp_value",
                                             "opam:v0.14.0"],
                                             ["@opam/ppxlib", "opam:0.22.2"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ppx_stable",
  new Map([["opam:v0.14.1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ppx__stable__opam__c__v0.14.1__910aee3a/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.14.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ppx_stable",
                                             "opam:v0.14.1"],
                                             ["@opam/ppxlib", "opam:0.22.2"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ppx_string",
  new Map([["opam:v0.14.1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ppx__string__opam__c__v0.14.1__edd0f333/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.14.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ppx_base",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_string",
                                             "opam:v0.14.1"],
                                             ["@opam/ppxlib", "opam:0.22.2"],
                                             ["@opam/stdio", "opam:v0.14.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ppx_typerep_conv",
  new Map([["opam:v0.14.2",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ppx__typerep__conv__opam__c__v0.14.2__ffda30af/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.14.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ppx_typerep_conv",
                                             "opam:v0.14.2"],
                                             ["@opam/ppxlib", "opam:0.22.2"],
                                             ["@opam/typerep",
                                             "opam:v0.14.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ppx_variants_conv",
  new Map([["opam:v0.14.1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ppx__variants__conv__opam__c__v0.14.1__19467032/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.14.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ppx_variants_conv",
                                             "opam:v0.14.1"],
                                             ["@opam/ppxlib", "opam:0.22.2"],
                                             ["@opam/variantslib",
                                             "opam:v0.14.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ppx_yojson",
  new Map([["opam:1.1.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ppx__yojson__opam__c__1.1.0__47596aea/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ppx_yojson",
                                             "opam:1.1.0"],
                                             ["@opam/ppxlib", "opam:0.22.2"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ppx_yojson_conv",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ppx__yojson__conv__opam__c__v0.14.0__19b8f895/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.14.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ppx_js_style",
                                             "opam:v0.14.1"],
                                             ["@opam/ppx_yojson_conv",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_yojson_conv_lib",
                                             "opam:v0.14.0"],
                                             ["@opam/ppxlib", "opam:0.22.2"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ppx_yojson_conv_lib",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ppx__yojson__conv__lib__opam__c__v0.14.0__dc949ddc/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ppx_yojson_conv_lib",
                                             "opam:v0.14.0"],
                                             ["@opam/yojson", "opam:1.7.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ppxlib",
  new Map([["opam:0.22.2",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ppxlib__opam__c__0.22.2__53ddaf55/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ocaml-compiler-libs",
                                             "opam:v0.12.3"],
                                             ["@opam/ocaml-migrate-parsetree",
                                             "opam:2.2.0"],
                                             ["@opam/ppx_derivers",
                                             "opam:1.2.1"],
                                             ["@opam/ppxlib", "opam:0.22.2"],
                                             ["@opam/sexplib0",
                                             "opam:v0.14.0"],
                                             ["@opam/stdlib-shims",
                                             "opam:0.3.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/prometheus",
  new Map([["opam:1.1",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__prometheus__opam__c__1.1__8d7dde70/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/asetmap", "opam:0.8.1"],
                                             ["@opam/astring", "opam:0.8.5"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/fmt", "opam:0.8.9"],
                                             ["@opam/lwt", "opam:5.4.1"],
                                             ["@opam/prometheus", "opam:1.1"],
                                             ["@opam/re", "opam:1.9.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/ptime",
  new Map([["opam:0.8.5",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__ptime__opam__c__0.8.5__79d19c69/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.0"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["@opam/ptime", "opam:0.8.5"],
                                             ["@opam/result", "opam:1.5"],
                                             ["@opam/topkg", "opam:1.0.3"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/qcheck-core",
  new Map([["opam:0.17",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__qcheck_core__opam__c__0.17__dacf4542/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-bytes",
                                             "opam:base"],
                                             ["@opam/base-unix", "opam:base"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/qcheck-core",
                                             "opam:0.17"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/re",
  new Map([["opam:1.9.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__re__opam__c__1.9.0__1a7a1e15/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/re", "opam:1.9.0"],
                                             ["@opam/seq", "opam:base"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/reason",
  new Map([["opam:3.7.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__reason__opam__c__3.7.0__f9466bf3/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/fix", "opam:20201120"],
                                             ["@opam/menhir",
                                             "opam:20210419"],
                                             ["@opam/merlin-extend",
                                             "opam:0.6"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["@opam/ppx_derivers",
                                             "opam:1.2.1"],
                                             ["@opam/reason", "opam:3.7.0"],
                                             ["@opam/result", "opam:1.5"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/result",
  new Map([["opam:1.5",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__result__opam__c__1.5__74485f30/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/result", "opam:1.5"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/rresult",
  new Map([["opam:0.6.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__rresult__opam__c__0.6.0__108d9e8f/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.0"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["@opam/result", "opam:1.5"],
                                             ["@opam/rresult", "opam:0.6.0"],
                                             ["@opam/topkg", "opam:1.0.3"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/seq",
  new Map([["opam:base",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__seq__opam__c__base__a0c677b1/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/seq", "opam:base"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/sexplib",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__sexplib__opam__c__v0.14.0__0ac5a13c/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/num", "opam:1.4"],
                                             ["@opam/parsexp",
                                             "opam:v0.14.1"],
                                             ["@opam/sexplib",
                                             "opam:v0.14.0"],
                                             ["@opam/sexplib0",
                                             "opam:v0.14.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/sexplib0",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__sexplib0__opam__c__v0.14.0__b1448c97/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/sexplib0",
                                             "opam:v0.14.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/spawn",
  new Map([["opam:v0.13.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__spawn__opam__c__v0.13.0__27c16533/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/spawn", "opam:v0.13.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/splittable_random",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__splittable__random__opam__c__v0.14.0__957dda5c/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.14.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ppx_assert",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_bench",
                                             "opam:v0.14.1"],
                                             ["@opam/ppx_inline_test",
                                             "opam:v0.14.1"],
                                             ["@opam/ppx_sexp_message",
                                             "opam:v0.14.1"],
                                             ["@opam/splittable_random",
                                             "opam:v0.14.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/stdio",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__stdio__opam__c__v0.14.0__16c0aeaf/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.14.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/stdio", "opam:v0.14.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/stdlib-shims",
  new Map([["opam:0.3.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__stdlib_shims__opam__c__0.3.0__daf52145/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/stdlib-shims",
                                             "opam:0.3.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/stringext",
  new Map([["opam:1.6.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__stringext__opam__c__1.6.0__69baaaa5/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-bytes",
                                             "opam:base"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/stringext",
                                             "opam:1.6.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/time_now",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__time__now__opam__c__v0.14.0__f10e7ecd/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.14.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/jane-street-headers",
                                             "opam:v0.14.0"],
                                             ["@opam/jst-config",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_base",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_optcomp",
                                             "opam:v0.14.2"],
                                             ["@opam/time_now",
                                             "opam:v0.14.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/timezone",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__timezone__opam__c__v0.14.0__654af384/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/core_kernel",
                                             "opam:v0.14.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ppx_jane",
                                             "opam:v0.14.0"],
                                             ["@opam/timezone",
                                             "opam:v0.14.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/topkg",
  new Map([["opam:1.0.3",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__topkg__opam__c__1.0.3__fce0cc7a/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.0"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["@opam/topkg", "opam:1.0.3"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/typerep",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__typerep__opam__c__v0.14.0__eba89992/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.14.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/typerep",
                                             "opam:v0.14.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/uchar",
  new Map([["opam:0.0.2",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__uchar__opam__c__0.0.2__d1ad73a0/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.0"],
                                             ["@opam/uchar", "opam:0.0.2"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/uri",
  new Map([["opam:4.2.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__uri__opam__c__4.2.0__9b4b8867/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/angstrom",
                                             "opam:0.15.0"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/stringext",
                                             "opam:1.6.0"],
                                             ["@opam/uri", "opam:4.2.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/uri-sexp",
  new Map([["opam:4.2.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__uri_sexp__opam__c__4.2.0__2007821d/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ppx_sexp_conv",
                                             "opam:v0.14.3"],
                                             ["@opam/sexplib0",
                                             "opam:v0.14.0"],
                                             ["@opam/uri", "opam:4.2.0"],
                                             ["@opam/uri-sexp", "opam:4.2.0"]])}]])],
  ["@opam/uuidm",
  new Map([["opam:0.9.7",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__uuidm__opam__c__0.9.7__52d754e2/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/cmdliner", "opam:1.0.4"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.0"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["@opam/topkg", "opam:1.0.3"],
                                             ["@opam/uuidm", "opam:0.9.7"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/uutf",
  new Map([["opam:1.0.2",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__uutf__opam__c__1.0.2__34474f09/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/cmdliner", "opam:1.0.4"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.0"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["@opam/topkg", "opam:1.0.3"],
                                             ["@opam/uchar", "opam:0.0.2"],
                                             ["@opam/uutf", "opam:1.0.2"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/variantslib",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__variantslib__opam__c__v0.14.0__788f7206/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.14.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/variantslib",
                                             "opam:v0.14.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/websocket",
  new Map([["opam:2.14",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__websocket__opam__c__2.14__26c48da4/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/astring", "opam:0.8.5"],
                                             ["@opam/base64", "opam:3.5.0"],
                                             ["@opam/cohttp", "opam:4.0.0"],
                                             ["@opam/conduit", "opam:4.0.0"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/ocplib-endian",
                                             "opam:1.1"],
                                             ["@opam/websocket", "opam:2.14"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/websocket-lwt-unix",
  new Map([["opam:2.14",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__websocket_lwt_unix__opam__c__2.14__31ff21a6/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/cohttp-lwt-unix",
                                             "opam:4.0.0"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/lwt_log", "opam:1.1.1"],
                                             ["@opam/websocket", "opam:2.14"],
                                             ["@opam/websocket-lwt-unix",
                                             "opam:2.14"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/x509",
  new Map([["opam:0.14.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__x509__opam__c__0.14.0__aaeb8386/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/asn1-combinators",
                                             "opam:0.2.5"],
                                             ["@opam/base64", "opam:3.5.0"],
                                             ["@opam/cstruct", "opam:6.0.1"],
                                             ["@opam/domain-name",
                                             "opam:0.3.0"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/fmt", "opam:0.8.9"],
                                             ["@opam/gmap", "opam:0.3.0"],
                                             ["@opam/logs", "opam:0.7.0"],
                                             ["@opam/mirage-crypto",
                                             "opam:0.10.3"],
                                             ["@opam/mirage-crypto-ec",
                                             "opam:0.10.3"],
                                             ["@opam/mirage-crypto-pk",
                                             "opam:0.10.3"],
                                             ["@opam/mirage-crypto-rng",
                                             "opam:0.10.3"],
                                             ["@opam/pbkdf", "opam:1.1.0"],
                                             ["@opam/ptime", "opam:0.8.5"],
                                             ["@opam/rresult", "opam:0.6.0"],
                                             ["@opam/x509", "opam:0.14.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/yojson",
  new Map([["opam:1.7.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__yojson__opam__c__1.7.0__5bfab1af/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/biniou", "opam:1.2.1"],
                                             ["@opam/cppo", "opam:1.6.7"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/easy-format",
                                             "opam:1.3.2"],
                                             ["@opam/yojson", "opam:1.7.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/zarith",
  new Map([["opam:1.12",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__zarith__opam__c__1.12__0eb91e89/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/conf-gmp", "opam:3"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["@opam/zarith", "opam:1.12"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@opam/zarith_stubs_js",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/opam__s__zarith__stubs__js__opam__c__v0.14.0__50524c30/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/zarith_stubs_js",
                                             "opam:v0.14.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@reason-native/console",
  new Map([["0.1.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/reason_native__s__console__0.1.0__d4af8f3d/",
             packageDependencies: new Map([["@esy-ocaml/reason",
                                           "github:EduardoRFS/reason:reason.json#35aa4df3de0daa60bdc1133dcf97855decac48f7"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@reason-native/console",
                                             "0.1.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["@reason-native/pastel",
  new Map([["0.3.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/reason_native__s__pastel__0.3.0__b97c16ec/",
             packageDependencies: new Map([["@esy-ocaml/reason",
                                           "github:EduardoRFS/reason:reason.json#35aa4df3de0daa60bdc1133dcf97855decac48f7"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/re", "opam:1.9.0"],
                                             ["@reason-native/pastel",
                                             "0.3.0"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["esy-gmp",
  new Map([["archive:https://gmplib.org/download/gmp/gmp-6.2.1.tar.xz#sha1:0578d48607ec0e272177d175fd1807c30b00fdf2",
           {
             packageLocation: "/Users/mando/.esy/source/i/esy_gmp__9e80dad6/",
             packageDependencies: new Map([["esy-gmp",
                                           "archive:https://gmplib.org/download/gmp/gmp-6.2.1.tar.xz#sha1:0578d48607ec0e272177d175fd1807c30b00fdf2"]])}]])],
  ["esy-libffi",
  new Map([["github:esy-ocaml/libffi#c61127dba57b18713039ab9c1892c9f2563e280c",
           {
             packageLocation: "/Users/mando/.esy/source/i/esy_libffi__a8a0b549/",
             packageDependencies: new Map([["esy-libffi",
                                           "github:esy-ocaml/libffi#c61127dba57b18713039ab9c1892c9f2563e280c"]])}]])],
  ["esy-m4",
  new Map([["github:esy-packages/esy-m4#c7cf0ac9221be2b1f9d90e83559ca08397a629e7",
           {
             packageLocation: "/Users/mando/.esy/source/i/esy_m4__779f59f5/",
             packageDependencies: new Map([["esy-m4",
                                           "github:esy-packages/esy-m4#c7cf0ac9221be2b1f9d90e83559ca08397a629e7"]])}]])],
  ["esy-pcre",
  new Map([["github:esy-packages/esy-pcre#c5076c8facbebaf5f5718c0e270418fd218add7e",
           {
             packageLocation: "/Users/mando/.esy/source/i/esy_pcre__f55c51e3/",
             packageDependencies: new Map([["esy-pcre",
                                           "github:esy-packages/esy-pcre#c5076c8facbebaf5f5718c0e270418fd218add7e"]])}]])],
  ["melange",
  new Map([["github:melange-re/melange#0987f1d582822dfe747095e586ec9878c83510ad",
           {
             packageLocation: "/Users/mando/.esy/source/i/melange__1e67c226/",
             packageDependencies: new Map([["@opam/cmdliner", "opam:1.0.4"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/dune-action-plugin",
                                             "opam:2.9.0"],
                                             ["@opam/melange-compiler-libs",
                                             "github:melange-re/melange-compiler-libs:melange-compiler-libs.opam#c787d2f98a"],
                                             ["@opam/reason", "opam:3.7.0"],
                                             ["melange",
                                             "github:melange-re/melange#0987f1d582822dfe747095e586ec9878c83510ad"],
                                             ["ocaml", "4.12.0"]])}]])],
  ["ocaml",
  new Map([["4.12.0",
           {
             packageLocation: "/Users/mando/.esy/source/i/ocaml__4.12.0__2b5694e6/",
             packageDependencies: new Map([["ocaml", "4.12.0"]])}]])],
  ["yarn-pkg-config",
  new Map([["github:esy-ocaml/yarn-pkg-config#db3a0b63883606dd57c54a7158d560d6cba8cd79",
           {
             packageLocation: "/Users/mando/.esy/source/i/yarn_pkg_config__9829fc81/",
             packageDependencies: new Map([["yarn-pkg-config",
                                           "github:esy-ocaml/yarn-pkg-config#db3a0b63883606dd57c54a7158d560d6cba8cd79"]])}]])],
  [null,
  new Map([[null,
           {
             packageLocation: "/Users/mando/Github/ocaml-todo/",
             packageDependencies: new Map([["@esy-ocaml/reason",
                                           "github:EduardoRFS/reason:reason.json#35aa4df3de0daa60bdc1133dcf97855decac48f7"],
                                             ["@opam/atdgen", "opam:2.2.1"],
                                             ["@opam/atdgen-runtime",
                                             "opam:2.2.1"],
                                             ["@opam/bignum", "opam:v0.14.0"],
                                             ["@opam/caqti", "opam:1.6.0"],
                                             ["@opam/caqti-driver-postgresql",
                                             "opam:1.6.0"],
                                             ["@opam/core", "opam:v0.14.1"],
                                             ["@opam/dotenv", "opam:0.0.3"],
                                             ["@opam/dune", "opam:2.9.0"],
                                             ["@opam/fmt", "opam:0.8.9"],
                                             ["@opam/httpaf", "opam:0.7.1"],
                                             ["@opam/logs", "opam:0.7.0"],
                                             ["@opam/lwt_ppx", "opam:2.0.2"],
                                             ["@opam/ocaml-lsp-server",
                                             "opam:1.7.0"],
                                             ["@opam/ocamlfind-secondary",
                                             "opam:1.8.1"],
                                             ["@opam/opium", "opam:0.17.1"],
                                             ["@opam/opium_kernel",
                                             "opam:0.17.1"],
                                             ["@opam/postgresql",
                                             "opam:5.0.0"],
                                             ["@opam/ppx_deriving_yojson",
                                             "opam:3.6.1"],
                                             ["@opam/ppx_rapper",
                                             "opam:3.0.0"],
                                             ["@opam/ppx_rapper_lwt",
                                             "opam:3.0.0"],
                                             ["@opam/ppx_yojson",
                                             "opam:1.1.0"],
                                             ["@opam/ppx_yojson_conv",
                                             "opam:v0.14.0"],
                                             ["@opam/prometheus", "opam:1.1"],
                                             ["@opam/qcheck-core",
                                             "opam:0.17"],
                                             ["@opam/reason", "opam:3.7.0"],
                                             ["@opam/stdio", "opam:v0.14.0"],
                                             ["@opam/uuidm", "opam:0.9.7"],
                                             ["@opam/websocket-lwt-unix",
                                             "opam:2.14"],
                                             ["@opam/yojson", "opam:1.7.0"],
                                             ["@reason-native/console",
                                             "0.1.0"],
                                             ["@reason-native/pastel",
                                             "0.3.0"],
                                             ["melange",
                                             "github:melange-re/melange#0987f1d582822dfe747095e586ec9878c83510ad"],
                                             ["ocaml", "4.12.0"]])}]])]]);

let locatorsByLocations = new Map([
["../../", topLevelLocator],
  ["../../../../.esy/source/i/esy_gmp__9e80dad6/",
  {
    name: "esy-gmp",
    reference: "archive:https://gmplib.org/download/gmp/gmp-6.2.1.tar.xz#sha1:0578d48607ec0e272177d175fd1807c30b00fdf2"}],
  ["../../../../.esy/source/i/esy_libffi__a8a0b549/",
  {
    name: "esy-libffi",
    reference: "github:esy-ocaml/libffi#c61127dba57b18713039ab9c1892c9f2563e280c"}],
  ["../../../../.esy/source/i/esy_m4__779f59f5/",
  {
    name: "esy-m4",
    reference: "github:esy-packages/esy-m4#c7cf0ac9221be2b1f9d90e83559ca08397a629e7"}],
  ["../../../../.esy/source/i/esy_ocaml__s__libffi__3.2.10__b56d4f27/",
  {
    name: "@esy-ocaml/libffi",
    reference: "3.2.10"}],
  ["../../../../.esy/source/i/esy_ocaml__s__reason__49164b1c/",
  {
    name: "@esy-ocaml/reason",
    reference: "github:EduardoRFS/reason:reason.json#35aa4df3de0daa60bdc1133dcf97855decac48f7"}],
  ["../../../../.esy/source/i/esy_ocaml__s__substs__0.0.1__19de1ee1/",
  {
    name: "@esy-ocaml/substs",
    reference: "0.0.1"}],
  ["../../../../.esy/source/i/esy_pcre__f55c51e3/",
  {
    name: "esy-pcre",
    reference: "github:esy-packages/esy-pcre#c5076c8facbebaf5f5718c0e270418fd218add7e"}],
  ["../../../../.esy/source/i/melange__1e67c226/",
  {
    name: "melange",
    reference: "github:melange-re/melange#0987f1d582822dfe747095e586ec9878c83510ad"}],
  ["../../../../.esy/source/i/ocaml__4.12.0__2b5694e6/",
  {
    name: "ocaml",
    reference: "4.12.0"}],
  ["../../../../.esy/source/i/opam__s__angstrom__opam__c__0.15.0__c5dca2a1/",
  {
    name: "@opam/angstrom",
    reference: "opam:0.15.0"}],
  ["../../../../.esy/source/i/opam__s__asetmap__opam__c__0.8.1__a7c0b750/",
  {
    name: "@opam/asetmap",
    reference: "opam:0.8.1"}],
  ["../../../../.esy/source/i/opam__s__asn1_combinators__opam__c__0.2.5__7e4e5b79/",
  {
    name: "@opam/asn1-combinators",
    reference: "opam:0.2.5"}],
  ["../../../../.esy/source/i/opam__s__astring__opam__c__0.8.5__471b9e4a/",
  {
    name: "@opam/astring",
    reference: "opam:0.8.5"}],
  ["../../../../.esy/source/i/opam__s__atd__opam__c__2.2.1__a8977c30/",
  {
    name: "@opam/atd",
    reference: "opam:2.2.1"}],
  ["../../../../.esy/source/i/opam__s__atdgen__opam__c__2.2.1__abe64188/",
  {
    name: "@opam/atdgen",
    reference: "opam:2.2.1"}],
  ["../../../../.esy/source/i/opam__s__atdgen_runtime__opam__c__2.2.1__f0510768/",
  {
    name: "@opam/atdgen-runtime",
    reference: "opam:2.2.1"}],
  ["../../../../.esy/source/i/opam__s__base64__opam__c__3.5.0__7cc64a98/",
  {
    name: "@opam/base64",
    reference: "opam:3.5.0"}],
  ["../../../../.esy/source/i/opam__s__base__bigstring__opam__c__v0.14.0__19ef1c8b/",
  {
    name: "@opam/base_bigstring",
    reference: "opam:v0.14.0"}],
  ["../../../../.esy/source/i/opam__s__base__opam__c__v0.14.1__e2aa1e81/",
  {
    name: "@opam/base",
    reference: "opam:v0.14.1"}],
  ["../../../../.esy/source/i/opam__s__base__quickcheck__opam__c__v0.14.1__c20699fe/",
  {
    name: "@opam/base_quickcheck",
    reference: "opam:v0.14.1"}],
  ["../../../../.esy/source/i/opam__s__base_bytes__opam__c__base__48b6019a/",
  {
    name: "@opam/base-bytes",
    reference: "opam:base"}],
  ["../../../../.esy/source/i/opam__s__base_threads__opam__c__base__f282958b/",
  {
    name: "@opam/base-threads",
    reference: "opam:base"}],
  ["../../../../.esy/source/i/opam__s__base_unix__opam__c__base__93427a57/",
  {
    name: "@opam/base-unix",
    reference: "opam:base"}],
  ["../../../../.esy/source/i/opam__s__bigarray_compat__opam__c__1.0.0__85f431b8/",
  {
    name: "@opam/bigarray-compat",
    reference: "opam:1.0.0"}],
  ["../../../../.esy/source/i/opam__s__bignum__opam__c__v0.14.0__1489ae6f/",
  {
    name: "@opam/bignum",
    reference: "opam:v0.14.0"}],
  ["../../../../.esy/source/i/opam__s__bigstringaf__opam__c__0.8.0__e5d3dc84/",
  {
    name: "@opam/bigstringaf",
    reference: "opam:0.8.0"}],
  ["../../../../.esy/source/i/opam__s__bin__prot__opam__c__v0.14.0__149bb2af/",
  {
    name: "@opam/bin_prot",
    reference: "opam:v0.14.0"}],
  ["../../../../.esy/source/i/opam__s__biniou__opam__c__1.2.1__9a37384b/",
  {
    name: "@opam/biniou",
    reference: "opam:1.2.1"}],
  ["../../../../.esy/source/i/opam__s__bos__opam__c__0.2.0__27475d3e/",
  {
    name: "@opam/bos",
    reference: "opam:0.2.0"}],
  ["../../../../.esy/source/i/opam__s__ca_certs__opam__c__0.2.1__c4d9849d/",
  {
    name: "@opam/ca-certs",
    reference: "opam:0.2.1"}],
  ["../../../../.esy/source/i/opam__s__caqti__opam__c__1.6.0__b891f183/",
  {
    name: "@opam/caqti",
    reference: "opam:1.6.0"}],
  ["../../../../.esy/source/i/opam__s__caqti_driver_postgresql__opam__c__1.6.0__8fc6a95a/",
  {
    name: "@opam/caqti-driver-postgresql",
    reference: "opam:1.6.0"}],
  ["../../../../.esy/source/i/opam__s__caqti_lwt__opam__c__1.6.0__0351158a/",
  {
    name: "@opam/caqti-lwt",
    reference: "opam:1.6.0"}],
  ["../../../../.esy/source/i/opam__s__cmdliner__opam__c__1.0.4__11482f41/",
  {
    name: "@opam/cmdliner",
    reference: "opam:1.0.4"}],
  ["../../../../.esy/source/i/opam__s__cohttp__opam__c__4.0.0__9d317795/",
  {
    name: "@opam/cohttp",
    reference: "opam:4.0.0"}],
  ["../../../../.esy/source/i/opam__s__cohttp_lwt__opam__c__4.0.0__b9ddef0a/",
  {
    name: "@opam/cohttp-lwt",
    reference: "opam:4.0.0"}],
  ["../../../../.esy/source/i/opam__s__cohttp_lwt_unix__opam__c__4.0.0__374d37db/",
  {
    name: "@opam/cohttp-lwt-unix",
    reference: "opam:4.0.0"}],
  ["../../../../.esy/source/i/opam__s__conduit__opam__c__4.0.0__0bc07767/",
  {
    name: "@opam/conduit",
    reference: "opam:4.0.0"}],
  ["../../../../.esy/source/i/opam__s__conduit_lwt__opam__c__4.0.0__17b83ca9/",
  {
    name: "@opam/conduit-lwt",
    reference: "opam:4.0.0"}],
  ["../../../../.esy/source/i/opam__s__conduit_lwt_unix__opam__c__4.0.0__d2be4fba/",
  {
    name: "@opam/conduit-lwt-unix",
    reference: "opam:4.0.0"}],
  ["../../../../.esy/source/i/opam__s__conf_gmp__opam__c__3__9642db88/",
  {
    name: "@opam/conf-gmp",
    reference: "opam:3"}],
  ["../../../../.esy/source/i/opam__s__conf_gmp_powm_sec__opam__c__3__0ac687f9/",
  {
    name: "@opam/conf-gmp-powm-sec",
    reference: "opam:3"}],
  ["../../../../.esy/source/i/opam__s__conf_libffi__opam__c__2.0.0__e563ab65/",
  {
    name: "@opam/conf-libffi",
    reference: "opam:2.0.0"}],
  ["../../../../.esy/source/i/opam__s__conf_libpcre__opam__c__1__4441479f/",
  {
    name: "@opam/conf-libpcre",
    reference: "opam:1"}],
  ["../../../../.esy/source/i/opam__s__conf_m4__opam__c__1__ecdf46a3/",
  {
    name: "@opam/conf-m4",
    reference: "opam:1"}],
  ["../../../../.esy/source/i/opam__s__conf_pkg_config__opam__c__2__f94434f0/",
  {
    name: "@opam/conf-pkg-config",
    reference: "opam:2"}],
  ["../../../../.esy/source/i/opam__s__conf_postgresql__opam__c__1__574941d3/",
  {
    name: "@opam/conf-postgresql",
    reference: "opam:1"}],
  ["../../../../.esy/source/i/opam__s__core__kernel__opam__c__v0.14.1__270ab316/",
  {
    name: "@opam/core_kernel",
    reference: "opam:v0.14.1"}],
  ["../../../../.esy/source/i/opam__s__core__opam__c__v0.14.1__1b64200c/",
  {
    name: "@opam/core",
    reference: "opam:v0.14.1"}],
  ["../../../../.esy/source/i/opam__s__cppo__opam__c__1.6.7__6c77bc8a/",
  {
    name: "@opam/cppo",
    reference: "opam:1.6.7"}],
  ["../../../../.esy/source/i/opam__s__csexp__opam__c__1.5.1__a5d42d7e/",
  {
    name: "@opam/csexp",
    reference: "opam:1.5.1"}],
  ["../../../../.esy/source/i/opam__s__cstruct__opam__c__6.0.1__5cf69c9a/",
  {
    name: "@opam/cstruct",
    reference: "opam:6.0.1"}],
  ["../../../../.esy/source/i/opam__s__ctypes__opam__c__0.19.1__f77bd3a9/",
  {
    name: "@opam/ctypes",
    reference: "opam:0.19.1"}],
  ["../../../../.esy/source/i/opam__s__ctypes_foreign__opam__c__0.18.0__6ebdb64b/",
  {
    name: "@opam/ctypes-foreign",
    reference: "opam:0.18.0"}],
  ["../../../../.esy/source/i/opam__s__domain_name__opam__c__0.3.0__212a23e1/",
  {
    name: "@opam/domain-name",
    reference: "opam:0.3.0"}],
  ["../../../../.esy/source/i/opam__s__dot_merlin_reader__opam__c__4.1__e3b8bf05/",
  {
    name: "@opam/dot-merlin-reader",
    reference: "opam:4.1"}],
  ["../../../../.esy/source/i/opam__s__dotenv__opam__c__0.0.3__06c1acff/",
  {
    name: "@opam/dotenv",
    reference: "opam:0.0.3"}],
  ["../../../../.esy/source/i/opam__s__dune__opam__c__2.9.0__f2432484/",
  {
    name: "@opam/dune",
    reference: "opam:2.9.0"}],
  ["../../../../.esy/source/i/opam__s__dune_action_plugin__opam__c__2.9.0__7cae86f4/",
  {
    name: "@opam/dune-action-plugin",
    reference: "opam:2.9.0"}],
  ["../../../../.esy/source/i/opam__s__dune_build_info__opam__c__2.9.0__cee778ca/",
  {
    name: "@opam/dune-build-info",
    reference: "opam:2.9.0"}],
  ["../../../../.esy/source/i/opam__s__dune_configurator__opam__c__2.9.0__fa79c0c2/",
  {
    name: "@opam/dune-configurator",
    reference: "opam:2.9.0"}],
  ["../../../../.esy/source/i/opam__s__dune_glob__opam__c__2.9.0__7d6b88c0/",
  {
    name: "@opam/dune-glob",
    reference: "opam:2.9.0"}],
  ["../../../../.esy/source/i/opam__s__dune_private_libs__opam__c__2.9.0__bfae01d9/",
  {
    name: "@opam/dune-private-libs",
    reference: "opam:2.9.0"}],
  ["../../../../.esy/source/i/opam__s__duration__opam__c__0.1.3__dcb75b2f/",
  {
    name: "@opam/duration",
    reference: "opam:0.1.3"}],
  ["../../../../.esy/source/i/opam__s__easy_format__opam__c__1.3.2__2be19d18/",
  {
    name: "@opam/easy-format",
    reference: "opam:1.3.2"}],
  ["../../../../.esy/source/i/opam__s__eqaf__opam__c__0.7__032806f7/",
  {
    name: "@opam/eqaf",
    reference: "opam:0.7"}],
  ["../../../../.esy/source/i/opam__s__ezjsonm__opam__c__1.1.0__14840b09/",
  {
    name: "@opam/ezjsonm",
    reference: "opam:1.1.0"}],
  ["../../../../.esy/source/i/opam__s__faraday__opam__c__0.8.1__284f95ca/",
  {
    name: "@opam/faraday",
    reference: "opam:0.8.1"}],
  ["../../../../.esy/source/i/opam__s__fieldslib__opam__c__v0.14.0__63238cb4/",
  {
    name: "@opam/fieldslib",
    reference: "opam:v0.14.0"}],
  ["../../../../.esy/source/i/opam__s__fix__opam__c__20201120__6248fa10/",
  {
    name: "@opam/fix",
    reference: "opam:20201120"}],
  ["../../../../.esy/source/i/opam__s__fmt__opam__c__0.8.9__dfac8787/",
  {
    name: "@opam/fmt",
    reference: "opam:0.8.9"}],
  ["../../../../.esy/source/i/opam__s__fpath__opam__c__0.7.3__18652e33/",
  {
    name: "@opam/fpath",
    reference: "opam:0.7.3"}],
  ["../../../../.esy/source/i/opam__s__gmap__opam__c__0.3.0__4ff017bd/",
  {
    name: "@opam/gmap",
    reference: "opam:0.3.0"}],
  ["../../../../.esy/source/i/opam__s__hex__opam__c__1.4.0__5566ecb7/",
  {
    name: "@opam/hex",
    reference: "opam:1.4.0"}],
  ["../../../../.esy/source/i/opam__s__hmap__opam__c__0.8.1__f8cac8ba/",
  {
    name: "@opam/hmap",
    reference: "opam:0.8.1"}],
  ["../../../../.esy/source/i/opam__s__httpaf__opam__c__0.7.1__7d1eed9b/",
  {
    name: "@opam/httpaf",
    reference: "opam:0.7.1"}],
  ["../../../../.esy/source/i/opam__s__integers__opam__c__0.4.0__c621597f/",
  {
    name: "@opam/integers",
    reference: "opam:0.4.0"}],
  ["../../../../.esy/source/i/opam__s__ipaddr__opam__c__5.1.0__45f4ce67/",
  {
    name: "@opam/ipaddr",
    reference: "opam:5.1.0"}],
  ["../../../../.esy/source/i/opam__s__ipaddr_sexp__opam__c__5.1.0__cbc93317/",
  {
    name: "@opam/ipaddr-sexp",
    reference: "opam:5.1.0"}],
  ["../../../../.esy/source/i/opam__s__jane_street_headers__opam__c__v0.14.0__2ed620b8/",
  {
    name: "@opam/jane-street-headers",
    reference: "opam:v0.14.0"}],
  ["../../../../.esy/source/i/opam__s__jsonm__opam__c__1.0.1__0f41f896/",
  {
    name: "@opam/jsonm",
    reference: "opam:1.0.1"}],
  ["../../../../.esy/source/i/opam__s__jst_config__opam__c__v0.14.0__8538ee8e/",
  {
    name: "@opam/jst-config",
    reference: "opam:v0.14.0"}],
  ["../../../../.esy/source/i/opam__s__logs__opam__c__0.7.0__cf15da05/",
  {
    name: "@opam/logs",
    reference: "opam:0.7.0"}],
  ["../../../../.esy/source/i/opam__s__lwt__log__opam__c__1.1.1__7f54b5d1/",
  {
    name: "@opam/lwt_log",
    reference: "opam:1.1.1"}],
  ["../../../../.esy/source/i/opam__s__lwt__opam__c__5.4.1__9dd6ef09/",
  {
    name: "@opam/lwt",
    reference: "opam:5.4.1"}],
  ["../../../../.esy/source/i/opam__s__lwt__ppx__opam__c__2.0.2__49533d10/",
  {
    name: "@opam/lwt_ppx",
    reference: "opam:2.0.2"}],
  ["../../../../.esy/source/i/opam__s__macaddr__opam__c__5.1.0__567b7407/",
  {
    name: "@opam/macaddr",
    reference: "opam:5.1.0"}],
  ["../../../../.esy/source/i/opam__s__magic_mime__opam__c__1.2.0__c9733c05/",
  {
    name: "@opam/magic-mime",
    reference: "opam:1.2.0"}],
  ["../../../../.esy/source/i/opam__s__melange_compiler_libs__5ee7bd99/",
  {
    name: "@opam/melange-compiler-libs",
    reference: "github:melange-re/melange-compiler-libs:melange-compiler-libs.opam#c787d2f98a"}],
  ["../../../../.esy/source/i/opam__s__menhir__opam__c__20210419__ee825b3c/",
  {
    name: "@opam/menhir",
    reference: "opam:20210419"}],
  ["../../../../.esy/source/i/opam__s__menhirlib__opam__c__20210419__61564494/",
  {
    name: "@opam/menhirLib",
    reference: "opam:20210419"}],
  ["../../../../.esy/source/i/opam__s__menhirsdk__opam__c__20210419__3462be48/",
  {
    name: "@opam/menhirSdk",
    reference: "opam:20210419"}],
  ["../../../../.esy/source/i/opam__s__merlin_extend__opam__c__0.6__4a4028a6/",
  {
    name: "@opam/merlin-extend",
    reference: "opam:0.6"}],
  ["../../../../.esy/source/i/opam__s__mirage_crypto__opam__c__0.10.3__0a26ec5a/",
  {
    name: "@opam/mirage-crypto",
    reference: "opam:0.10.3"}],
  ["../../../../.esy/source/i/opam__s__mirage_crypto_ec__opam__c__0.10.3__ccea7be3/",
  {
    name: "@opam/mirage-crypto-ec",
    reference: "opam:0.10.3"}],
  ["../../../../.esy/source/i/opam__s__mirage_crypto_pk__opam__c__0.10.3__4de1d181/",
  {
    name: "@opam/mirage-crypto-pk",
    reference: "opam:0.10.3"}],
  ["../../../../.esy/source/i/opam__s__mirage_crypto_rng__opam__c__0.10.3__00ea5b06/",
  {
    name: "@opam/mirage-crypto-rng",
    reference: "opam:0.10.3"}],
  ["../../../../.esy/source/i/opam__s__mirage_no_solo5__opam__c__1__0dfe7436/",
  {
    name: "@opam/mirage-no-solo5",
    reference: "opam:1"}],
  ["../../../../.esy/source/i/opam__s__mirage_no_xen__opam__c__1__5b4fa424/",
  {
    name: "@opam/mirage-no-xen",
    reference: "opam:1"}],
  ["../../../../.esy/source/i/opam__s__mmap__opam__c__1.1.0__2cba59f8/",
  {
    name: "@opam/mmap",
    reference: "opam:1.1.0"}],
  ["../../../../.esy/source/i/opam__s__mtime__opam__c__1.2.0__a4b0f312/",
  {
    name: "@opam/mtime",
    reference: "opam:1.2.0"}],
  ["../../../../.esy/source/i/opam__s__num__opam__c__1.4__80adde80/",
  {
    name: "@opam/num",
    reference: "opam:1.4"}],
  ["../../../../.esy/source/i/opam__s__ocaml_compiler_libs__opam__c__v0.12.3__777e40be/",
  {
    name: "@opam/ocaml-compiler-libs",
    reference: "opam:v0.12.3"}],
  ["../../../../.esy/source/i/opam__s__ocaml_lsp_server__opam__c__1.7.0__8dd35f22/",
  {
    name: "@opam/ocaml-lsp-server",
    reference: "opam:1.7.0"}],
  ["../../../../.esy/source/i/opam__s__ocaml_migrate_parsetree__opam__c__2.2.0__f0755492/",
  {
    name: "@opam/ocaml-migrate-parsetree",
    reference: "opam:2.2.0"}],
  ["../../../../.esy/source/i/opam__s__ocaml_secondary_compiler__opam__c__4.08.1_1__d0da7c19/",
  {
    name: "@opam/ocaml-secondary-compiler",
    reference: "opam:4.08.1-1"}],
  ["../../../../.esy/source/i/opam__s__ocaml_syntax_shims__opam__c__1.0.0__cb8d5a09/",
  {
    name: "@opam/ocaml-syntax-shims",
    reference: "opam:1.0.0"}],
  ["../../../../.esy/source/i/opam__s__ocamlbuild__opam__c__0.14.0__aff6a0b0/",
  {
    name: "@opam/ocamlbuild",
    reference: "opam:0.14.0"}],
  ["../../../../.esy/source/i/opam__s__ocamlfind__opam__c__1.8.1__ab68a5ee/",
  {
    name: "@opam/ocamlfind",
    reference: "opam:1.8.1"}],
  ["../../../../.esy/source/i/opam__s__ocamlfind_secondary__opam__c__1.8.1__0797ff08/",
  {
    name: "@opam/ocamlfind-secondary",
    reference: "opam:1.8.1"}],
  ["../../../../.esy/source/i/opam__s__ocplib_endian__opam__c__1.1__729a5869/",
  {
    name: "@opam/ocplib-endian",
    reference: "opam:1.1"}],
  ["../../../../.esy/source/i/opam__s__octavius__opam__c__1.2.2__96807fc5/",
  {
    name: "@opam/octavius",
    reference: "opam:1.2.2"}],
  ["../../../../.esy/source/i/opam__s__opium__kernel__opam__c__0.17.1__56b6d155/",
  {
    name: "@opam/opium_kernel",
    reference: "opam:0.17.1"}],
  ["../../../../.esy/source/i/opam__s__opium__opam__c__0.17.1__5de99d51/",
  {
    name: "@opam/opium",
    reference: "opam:0.17.1"}],
  ["../../../../.esy/source/i/opam__s__parsexp__opam__c__v0.14.1__051ca407/",
  {
    name: "@opam/parsexp",
    reference: "opam:v0.14.1"}],
  ["../../../../.esy/source/i/opam__s__pbkdf__opam__c__1.1.0__0f31f372/",
  {
    name: "@opam/pbkdf",
    reference: "opam:1.1.0"}],
  ["../../../../.esy/source/i/opam__s__pcre__opam__c__7.5.0__08b3a44f/",
  {
    name: "@opam/pcre",
    reference: "opam:7.5.0"}],
  ["../../../../.esy/source/i/opam__s__pg__query__opam__c__0.9.7__eba2497d/",
  {
    name: "@opam/pg_query",
    reference: "opam:0.9.7"}],
  ["../../../../.esy/source/i/opam__s__postgresql__opam__c__5.0.0__1fd0f07a/",
  {
    name: "@opam/postgresql",
    reference: "opam:5.0.0"}],
  ["../../../../.esy/source/i/opam__s__pp__opam__c__1.1.2__ebad31ff/",
  {
    name: "@opam/pp",
    reference: "opam:1.1.2"}],
  ["../../../../.esy/source/i/opam__s__ppx__assert__opam__c__v0.14.0__41578bf1/",
  {
    name: "@opam/ppx_assert",
    reference: "opam:v0.14.0"}],
  ["../../../../.esy/source/i/opam__s__ppx__base__opam__c__v0.14.0__69130302/",
  {
    name: "@opam/ppx_base",
    reference: "opam:v0.14.0"}],
  ["../../../../.esy/source/i/opam__s__ppx__bench__opam__c__v0.14.1__0150ca22/",
  {
    name: "@opam/ppx_bench",
    reference: "opam:v0.14.1"}],
  ["../../../../.esy/source/i/opam__s__ppx__bin__prot__opam__c__v0.14.0__ee186529/",
  {
    name: "@opam/ppx_bin_prot",
    reference: "opam:v0.14.0"}],
  ["../../../../.esy/source/i/opam__s__ppx__cold__opam__c__v0.14.0__20831c56/",
  {
    name: "@opam/ppx_cold",
    reference: "opam:v0.14.0"}],
  ["../../../../.esy/source/i/opam__s__ppx__compare__opam__c__v0.14.0__d8a7262e/",
  {
    name: "@opam/ppx_compare",
    reference: "opam:v0.14.0"}],
  ["../../../../.esy/source/i/opam__s__ppx__custom__printf__opam__c__v0.14.1__c81a23d7/",
  {
    name: "@opam/ppx_custom_printf",
    reference: "opam:v0.14.1"}],
  ["../../../../.esy/source/i/opam__s__ppx__derivers__opam__c__1.2.1__a5e0f03f/",
  {
    name: "@opam/ppx_derivers",
    reference: "opam:1.2.1"}],
  ["../../../../.esy/source/i/opam__s__ppx__deriving__opam__c__5.2.1__7dc03006/",
  {
    name: "@opam/ppx_deriving",
    reference: "opam:5.2.1"}],
  ["../../../../.esy/source/i/opam__s__ppx__deriving__yojson__opam__c__3.6.1__f7812344/",
  {
    name: "@opam/ppx_deriving_yojson",
    reference: "opam:3.6.1"}],
  ["../../../../.esy/source/i/opam__s__ppx__enumerate__opam__c__v0.14.0__5fc8f5bc/",
  {
    name: "@opam/ppx_enumerate",
    reference: "opam:v0.14.0"}],
  ["../../../../.esy/source/i/opam__s__ppx__expect__opam__c__v0.14.1__91ba70f8/",
  {
    name: "@opam/ppx_expect",
    reference: "opam:v0.14.1"}],
  ["../../../../.esy/source/i/opam__s__ppx__fields__conv__opam__c__v0.14.2__1e26fc9a/",
  {
    name: "@opam/ppx_fields_conv",
    reference: "opam:v0.14.2"}],
  ["../../../../.esy/source/i/opam__s__ppx__fixed__literal__opam__c__v0.14.0__3e956caf/",
  {
    name: "@opam/ppx_fixed_literal",
    reference: "opam:v0.14.0"}],
  ["../../../../.esy/source/i/opam__s__ppx__hash__opam__c__v0.14.0__84fc2573/",
  {
    name: "@opam/ppx_hash",
    reference: "opam:v0.14.0"}],
  ["../../../../.esy/source/i/opam__s__ppx__here__opam__c__v0.14.0__fefd8712/",
  {
    name: "@opam/ppx_here",
    reference: "opam:v0.14.0"}],
  ["../../../../.esy/source/i/opam__s__ppx__inline__test__opam__c__v0.14.1__ba73c193/",
  {
    name: "@opam/ppx_inline_test",
    reference: "opam:v0.14.1"}],
  ["../../../../.esy/source/i/opam__s__ppx__jane__opam__c__v0.14.0__280af509/",
  {
    name: "@opam/ppx_jane",
    reference: "opam:v0.14.0"}],
  ["../../../../.esy/source/i/opam__s__ppx__js__style__opam__c__v0.14.1__927575a1/",
  {
    name: "@opam/ppx_js_style",
    reference: "opam:v0.14.1"}],
  ["../../../../.esy/source/i/opam__s__ppx__let__opam__c__v0.14.0__61e3bda3/",
  {
    name: "@opam/ppx_let",
    reference: "opam:v0.14.0"}],
  ["../../../../.esy/source/i/opam__s__ppx__module__timer__opam__c__v0.14.0__bfabd415/",
  {
    name: "@opam/ppx_module_timer",
    reference: "opam:v0.14.0"}],
  ["../../../../.esy/source/i/opam__s__ppx__optcomp__opam__c__v0.14.2__db3c8474/",
  {
    name: "@opam/ppx_optcomp",
    reference: "opam:v0.14.2"}],
  ["../../../../.esy/source/i/opam__s__ppx__optional__opam__c__v0.14.0__ea191660/",
  {
    name: "@opam/ppx_optional",
    reference: "opam:v0.14.0"}],
  ["../../../../.esy/source/i/opam__s__ppx__pipebang__opam__c__v0.14.0__ac4eb04b/",
  {
    name: "@opam/ppx_pipebang",
    reference: "opam:v0.14.0"}],
  ["../../../../.esy/source/i/opam__s__ppx__rapper__lwt__opam__c__3.0.0__b5725b11/",
  {
    name: "@opam/ppx_rapper_lwt",
    reference: "opam:3.0.0"}],
  ["../../../../.esy/source/i/opam__s__ppx__rapper__opam__c__3.0.0__34fc2f77/",
  {
    name: "@opam/ppx_rapper",
    reference: "opam:3.0.0"}],
  ["../../../../.esy/source/i/opam__s__ppx__sexp__conv__opam__c__v0.14.3__c785b6cc/",
  {
    name: "@opam/ppx_sexp_conv",
    reference: "opam:v0.14.3"}],
  ["../../../../.esy/source/i/opam__s__ppx__sexp__message__opam__c__v0.14.1__a4755916/",
  {
    name: "@opam/ppx_sexp_message",
    reference: "opam:v0.14.1"}],
  ["../../../../.esy/source/i/opam__s__ppx__sexp__value__opam__c__v0.14.0__6e0ebda3/",
  {
    name: "@opam/ppx_sexp_value",
    reference: "opam:v0.14.0"}],
  ["../../../../.esy/source/i/opam__s__ppx__stable__opam__c__v0.14.1__910aee3a/",
  {
    name: "@opam/ppx_stable",
    reference: "opam:v0.14.1"}],
  ["../../../../.esy/source/i/opam__s__ppx__string__opam__c__v0.14.1__edd0f333/",
  {
    name: "@opam/ppx_string",
    reference: "opam:v0.14.1"}],
  ["../../../../.esy/source/i/opam__s__ppx__typerep__conv__opam__c__v0.14.2__ffda30af/",
  {
    name: "@opam/ppx_typerep_conv",
    reference: "opam:v0.14.2"}],
  ["../../../../.esy/source/i/opam__s__ppx__variants__conv__opam__c__v0.14.1__19467032/",
  {
    name: "@opam/ppx_variants_conv",
    reference: "opam:v0.14.1"}],
  ["../../../../.esy/source/i/opam__s__ppx__yojson__conv__lib__opam__c__v0.14.0__dc949ddc/",
  {
    name: "@opam/ppx_yojson_conv_lib",
    reference: "opam:v0.14.0"}],
  ["../../../../.esy/source/i/opam__s__ppx__yojson__conv__opam__c__v0.14.0__19b8f895/",
  {
    name: "@opam/ppx_yojson_conv",
    reference: "opam:v0.14.0"}],
  ["../../../../.esy/source/i/opam__s__ppx__yojson__opam__c__1.1.0__47596aea/",
  {
    name: "@opam/ppx_yojson",
    reference: "opam:1.1.0"}],
  ["../../../../.esy/source/i/opam__s__ppxlib__opam__c__0.22.2__53ddaf55/",
  {
    name: "@opam/ppxlib",
    reference: "opam:0.22.2"}],
  ["../../../../.esy/source/i/opam__s__prometheus__opam__c__1.1__8d7dde70/",
  {
    name: "@opam/prometheus",
    reference: "opam:1.1"}],
  ["../../../../.esy/source/i/opam__s__ptime__opam__c__0.8.5__79d19c69/",
  {
    name: "@opam/ptime",
    reference: "opam:0.8.5"}],
  ["../../../../.esy/source/i/opam__s__qcheck_core__opam__c__0.17__dacf4542/",
  {
    name: "@opam/qcheck-core",
    reference: "opam:0.17"}],
  ["../../../../.esy/source/i/opam__s__re__opam__c__1.9.0__1a7a1e15/",
  {
    name: "@opam/re",
    reference: "opam:1.9.0"}],
  ["../../../../.esy/source/i/opam__s__reason__opam__c__3.7.0__f9466bf3/",
  {
    name: "@opam/reason",
    reference: "opam:3.7.0"}],
  ["../../../../.esy/source/i/opam__s__result__opam__c__1.5__74485f30/",
  {
    name: "@opam/result",
    reference: "opam:1.5"}],
  ["../../../../.esy/source/i/opam__s__rresult__opam__c__0.6.0__108d9e8f/",
  {
    name: "@opam/rresult",
    reference: "opam:0.6.0"}],
  ["../../../../.esy/source/i/opam__s__seq__opam__c__base__a0c677b1/",
  {
    name: "@opam/seq",
    reference: "opam:base"}],
  ["../../../../.esy/source/i/opam__s__sexplib0__opam__c__v0.14.0__b1448c97/",
  {
    name: "@opam/sexplib0",
    reference: "opam:v0.14.0"}],
  ["../../../../.esy/source/i/opam__s__sexplib__opam__c__v0.14.0__0ac5a13c/",
  {
    name: "@opam/sexplib",
    reference: "opam:v0.14.0"}],
  ["../../../../.esy/source/i/opam__s__spawn__opam__c__v0.13.0__27c16533/",
  {
    name: "@opam/spawn",
    reference: "opam:v0.13.0"}],
  ["../../../../.esy/source/i/opam__s__splittable__random__opam__c__v0.14.0__957dda5c/",
  {
    name: "@opam/splittable_random",
    reference: "opam:v0.14.0"}],
  ["../../../../.esy/source/i/opam__s__stdio__opam__c__v0.14.0__16c0aeaf/",
  {
    name: "@opam/stdio",
    reference: "opam:v0.14.0"}],
  ["../../../../.esy/source/i/opam__s__stdlib_shims__opam__c__0.3.0__daf52145/",
  {
    name: "@opam/stdlib-shims",
    reference: "opam:0.3.0"}],
  ["../../../../.esy/source/i/opam__s__stringext__opam__c__1.6.0__69baaaa5/",
  {
    name: "@opam/stringext",
    reference: "opam:1.6.0"}],
  ["../../../../.esy/source/i/opam__s__time__now__opam__c__v0.14.0__f10e7ecd/",
  {
    name: "@opam/time_now",
    reference: "opam:v0.14.0"}],
  ["../../../../.esy/source/i/opam__s__timezone__opam__c__v0.14.0__654af384/",
  {
    name: "@opam/timezone",
    reference: "opam:v0.14.0"}],
  ["../../../../.esy/source/i/opam__s__topkg__opam__c__1.0.3__fce0cc7a/",
  {
    name: "@opam/topkg",
    reference: "opam:1.0.3"}],
  ["../../../../.esy/source/i/opam__s__typerep__opam__c__v0.14.0__eba89992/",
  {
    name: "@opam/typerep",
    reference: "opam:v0.14.0"}],
  ["../../../../.esy/source/i/opam__s__uchar__opam__c__0.0.2__d1ad73a0/",
  {
    name: "@opam/uchar",
    reference: "opam:0.0.2"}],
  ["../../../../.esy/source/i/opam__s__uri__opam__c__4.2.0__9b4b8867/",
  {
    name: "@opam/uri",
    reference: "opam:4.2.0"}],
  ["../../../../.esy/source/i/opam__s__uri_sexp__opam__c__4.2.0__2007821d/",
  {
    name: "@opam/uri-sexp",
    reference: "opam:4.2.0"}],
  ["../../../../.esy/source/i/opam__s__uuidm__opam__c__0.9.7__52d754e2/",
  {
    name: "@opam/uuidm",
    reference: "opam:0.9.7"}],
  ["../../../../.esy/source/i/opam__s__uutf__opam__c__1.0.2__34474f09/",
  {
    name: "@opam/uutf",
    reference: "opam:1.0.2"}],
  ["../../../../.esy/source/i/opam__s__variantslib__opam__c__v0.14.0__788f7206/",
  {
    name: "@opam/variantslib",
    reference: "opam:v0.14.0"}],
  ["../../../../.esy/source/i/opam__s__websocket__opam__c__2.14__26c48da4/",
  {
    name: "@opam/websocket",
    reference: "opam:2.14"}],
  ["../../../../.esy/source/i/opam__s__websocket_lwt_unix__opam__c__2.14__31ff21a6/",
  {
    name: "@opam/websocket-lwt-unix",
    reference: "opam:2.14"}],
  ["../../../../.esy/source/i/opam__s__x509__opam__c__0.14.0__aaeb8386/",
  {
    name: "@opam/x509",
    reference: "opam:0.14.0"}],
  ["../../../../.esy/source/i/opam__s__yojson__opam__c__1.7.0__5bfab1af/",
  {
    name: "@opam/yojson",
    reference: "opam:1.7.0"}],
  ["../../../../.esy/source/i/opam__s__zarith__opam__c__1.12__0eb91e89/",
  {
    name: "@opam/zarith",
    reference: "opam:1.12"}],
  ["../../../../.esy/source/i/opam__s__zarith__stubs__js__opam__c__v0.14.0__50524c30/",
  {
    name: "@opam/zarith_stubs_js",
    reference: "opam:v0.14.0"}],
  ["../../../../.esy/source/i/reason_native__s__console__0.1.0__d4af8f3d/",
  {
    name: "@reason-native/console",
    reference: "0.1.0"}],
  ["../../../../.esy/source/i/reason_native__s__pastel__0.3.0__b97c16ec/",
  {
    name: "@reason-native/pastel",
    reference: "0.3.0"}],
  ["../../../../.esy/source/i/yarn_pkg_config__9829fc81/",
  {
    name: "yarn-pkg-config",
    reference: "github:esy-ocaml/yarn-pkg-config#db3a0b63883606dd57c54a7158d560d6cba8cd79"}]]);


  exports.findPackageLocator = function findPackageLocator(location) {
    let relativeLocation = normalizePath(path.relative(__dirname, location));

    if (!relativeLocation.match(isStrictRegExp))
      relativeLocation = `./${relativeLocation}`;

    if (location.match(isDirRegExp) && relativeLocation.charAt(relativeLocation.length - 1) !== '/')
      relativeLocation = `${relativeLocation}/`;

    let match;

  
      if (relativeLocation.length >= 89 && relativeLocation[88] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 89)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 86 && relativeLocation[85] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 86)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 85 && relativeLocation[84] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 85)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 83 && relativeLocation[82] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 83)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 82 && relativeLocation[81] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 82)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 81 && relativeLocation[80] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 81)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 80 && relativeLocation[79] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 80)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 79 && relativeLocation[78] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 79)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 78 && relativeLocation[77] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 78)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 77 && relativeLocation[76] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 77)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 76 && relativeLocation[75] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 76)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 75 && relativeLocation[74] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 75)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 74 && relativeLocation[73] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 74)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 73 && relativeLocation[72] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 73)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 72 && relativeLocation[71] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 72)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 71 && relativeLocation[70] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 71)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 70 && relativeLocation[69] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 70)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 69 && relativeLocation[68] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 69)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 68 && relativeLocation[67] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 68)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 67 && relativeLocation[66] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 67)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 66 && relativeLocation[65] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 66)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 65 && relativeLocation[64] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 65)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 64 && relativeLocation[63] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 64)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 63 && relativeLocation[62] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 63)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 57 && relativeLocation[56] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 57)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 52 && relativeLocation[51] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 52)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 50 && relativeLocation[49] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 50)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 47 && relativeLocation[46] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 47)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 45 && relativeLocation[44] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 45)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 44 && relativeLocation[43] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 44)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 43 && relativeLocation[42] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 43)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 6 && relativeLocation[5] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 6)))
          return blacklistCheck(match);
      

    return null;
  };
  

/**
 * Returns the module that should be used to resolve require calls. It's usually the direct parent, except if we're
 * inside an eval expression.
 */

function getIssuerModule(parent) {
  let issuer = parent;

  while (issuer && (issuer.id === '[eval]' || issuer.id === '<repl>' || !issuer.filename)) {
    issuer = issuer.parent;
  }

  return issuer;
}

/**
 * Returns information about a package in a safe way (will throw if they cannot be retrieved)
 */

function getPackageInformationSafe(packageLocator) {
  const packageInformation = exports.getPackageInformation(packageLocator);

  if (!packageInformation) {
    throw makeError(
      `INTERNAL`,
      `Couldn't find a matching entry in the dependency tree for the specified parent (this is probably an internal error)`
    );
  }

  return packageInformation;
}

/**
 * Implements the node resolution for folder access and extension selection
 */

function applyNodeExtensionResolution(unqualifiedPath, {extensions}) {
  // We use this "infinite while" so that we can restart the process as long as we hit package folders
  while (true) {
    let stat;

    try {
      stat = statSync(unqualifiedPath);
    } catch (error) {}

    // If the file exists and is a file, we can stop right there

    if (stat && !stat.isDirectory()) {
      // If the very last component of the resolved path is a symlink to a file, we then resolve it to a file. We only
      // do this first the last component, and not the rest of the path! This allows us to support the case of bin
      // symlinks, where a symlink in "/xyz/pkg-name/.bin/bin-name" will point somewhere else (like "/xyz/pkg-name/index.js").
      // In such a case, we want relative requires to be resolved relative to "/xyz/pkg-name/" rather than "/xyz/pkg-name/.bin/".
      //
      // Also note that the reason we must use readlink on the last component (instead of realpath on the whole path)
      // is that we must preserve the other symlinks, in particular those used by pnp to deambiguate packages using
      // peer dependencies. For example, "/xyz/.pnp/local/pnp-01234569/.bin/bin-name" should see its relative requires
      // be resolved relative to "/xyz/.pnp/local/pnp-0123456789/" rather than "/xyz/pkg-with-peers/", because otherwise
      // we would lose the information that would tell us what are the dependencies of pkg-with-peers relative to its
      // ancestors.

      if (lstatSync(unqualifiedPath).isSymbolicLink()) {
        unqualifiedPath = path.normalize(path.resolve(path.dirname(unqualifiedPath), readlinkSync(unqualifiedPath)));
      }

      return unqualifiedPath;
    }

    // If the file is a directory, we must check if it contains a package.json with a "main" entry

    if (stat && stat.isDirectory()) {
      let pkgJson;

      try {
        pkgJson = JSON.parse(readFileSync(`${unqualifiedPath}/package.json`, 'utf-8'));
      } catch (error) {}

      let nextUnqualifiedPath;

      if (pkgJson && pkgJson.main) {
        nextUnqualifiedPath = path.resolve(unqualifiedPath, pkgJson.main);
      }

      // If the "main" field changed the path, we start again from this new location

      if (nextUnqualifiedPath && nextUnqualifiedPath !== unqualifiedPath) {
        const resolution = applyNodeExtensionResolution(nextUnqualifiedPath, {extensions});

        if (resolution !== null) {
          return resolution;
        }
      }
    }

    // Otherwise we check if we find a file that match one of the supported extensions

    const qualifiedPath = extensions
      .map(extension => {
        return `${unqualifiedPath}${extension}`;
      })
      .find(candidateFile => {
        return existsSync(candidateFile);
      });

    if (qualifiedPath) {
      return qualifiedPath;
    }

    // Otherwise, we check if the path is a folder - in such a case, we try to use its index

    if (stat && stat.isDirectory()) {
      const indexPath = extensions
        .map(extension => {
          return `${unqualifiedPath}/index${extension}`;
        })
        .find(candidateFile => {
          return existsSync(candidateFile);
        });

      if (indexPath) {
        return indexPath;
      }
    }

    // Otherwise there's nothing else we can do :(

    return null;
  }
}

/**
 * This function creates fake modules that can be used with the _resolveFilename function.
 * Ideally it would be nice to be able to avoid this, since it causes useless allocations
 * and cannot be cached efficiently (we recompute the nodeModulePaths every time).
 *
 * Fortunately, this should only affect the fallback, and there hopefully shouldn't be a
 * lot of them.
 */

function makeFakeModule(path) {
  const fakeModule = new Module(path, false);
  fakeModule.filename = path;
  fakeModule.paths = Module._nodeModulePaths(path);
  return fakeModule;
}

/**
 * Normalize path to posix format.
 */

// eslint-disable-next-line no-unused-vars
function normalizePath(fsPath) {
  fsPath = path.normalize(fsPath);

  if (process.platform === 'win32') {
    fsPath = fsPath.replace(backwardSlashRegExp, '/');
  }

  return fsPath;
}

/**
 * Forward the resolution to the next resolver (usually the native one)
 */

function callNativeResolution(request, issuer) {
  if (issuer.endsWith('/')) {
    issuer += 'internal.js';
  }

  try {
    enableNativeHooks = false;

    // Since we would need to create a fake module anyway (to call _resolveLookupPath that
    // would give us the paths to give to _resolveFilename), we can as well not use
    // the {paths} option at all, since it internally makes _resolveFilename create another
    // fake module anyway.
    return Module._resolveFilename(request, makeFakeModule(issuer), false);
  } finally {
    enableNativeHooks = true;
  }
}

/**
 * This key indicates which version of the standard is implemented by this resolver. The `std` key is the
 * Plug'n'Play standard, and any other key are third-party extensions. Third-party extensions are not allowed
 * to override the standard, and can only offer new methods.
 *
 * If an new version of the Plug'n'Play standard is released and some extensions conflict with newly added
 * functions, they'll just have to fix the conflicts and bump their own version number.
 */

exports.VERSIONS = {std: 1};

/**
 * Useful when used together with getPackageInformation to fetch information about the top-level package.
 */

exports.topLevel = {name: null, reference: null};

/**
 * Gets the package information for a given locator. Returns null if they cannot be retrieved.
 */

exports.getPackageInformation = function getPackageInformation({name, reference}) {
  const packageInformationStore = packageInformationStores.get(name);

  if (!packageInformationStore) {
    return null;
  }

  const packageInformation = packageInformationStore.get(reference);

  if (!packageInformation) {
    return null;
  }

  return packageInformation;
};

/**
 * Transforms a request (what's typically passed as argument to the require function) into an unqualified path.
 * This path is called "unqualified" because it only changes the package name to the package location on the disk,
 * which means that the end result still cannot be directly accessed (for example, it doesn't try to resolve the
 * file extension, or to resolve directories to their "index.js" content). Use the "resolveUnqualified" function
 * to convert them to fully-qualified paths, or just use "resolveRequest" that do both operations in one go.
 *
 * Note that it is extremely important that the `issuer` path ends with a forward slash if the issuer is to be
 * treated as a folder (ie. "/tmp/foo/" rather than "/tmp/foo" if "foo" is a directory). Otherwise relative
 * imports won't be computed correctly (they'll get resolved relative to "/tmp/" instead of "/tmp/foo/").
 */

exports.resolveToUnqualified = function resolveToUnqualified(request, issuer, {considerBuiltins = true} = {}) {
  // The 'pnpapi' request is reserved and will always return the path to the PnP file, from everywhere

  if (request === `pnpapi`) {
    return pnpFile;
  }

  // Bailout if the request is a native module

  if (considerBuiltins && builtinModules.has(request)) {
    return null;
  }

  // We allow disabling the pnp resolution for some subpaths. This is because some projects, often legacy,
  // contain multiple levels of dependencies (ie. a yarn.lock inside a subfolder of a yarn.lock). This is
  // typically solved using workspaces, but not all of them have been converted already.

  if (ignorePattern && ignorePattern.test(normalizePath(issuer))) {
    const result = callNativeResolution(request, issuer);

    if (result === false) {
      throw makeError(
        `BUILTIN_NODE_RESOLUTION_FAIL`,
        `The builtin node resolution algorithm was unable to resolve the module referenced by "${request}" and requested from "${issuer}" (it didn't go through the pnp resolver because the issuer was explicitely ignored by the regexp "$$BLACKLIST")`,
        {
          request,
          issuer
        }
      );
    }

    return result;
  }

  let unqualifiedPath;

  // If the request is a relative or absolute path, we just return it normalized

  const dependencyNameMatch = request.match(pathRegExp);

  if (!dependencyNameMatch) {
    if (path.isAbsolute(request)) {
      unqualifiedPath = path.normalize(request);
    } else if (issuer.match(isDirRegExp)) {
      unqualifiedPath = path.normalize(path.resolve(issuer, request));
    } else {
      unqualifiedPath = path.normalize(path.resolve(path.dirname(issuer), request));
    }
  }

  // Things are more hairy if it's a package require - we then need to figure out which package is needed, and in
  // particular the exact version for the given location on the dependency tree

  if (dependencyNameMatch) {
    const [, dependencyName, subPath] = dependencyNameMatch;

    const issuerLocator = exports.findPackageLocator(issuer);

    // If the issuer file doesn't seem to be owned by a package managed through pnp, then we resort to using the next
    // resolution algorithm in the chain, usually the native Node resolution one

    if (!issuerLocator) {
      const result = callNativeResolution(request, issuer);

      if (result === false) {
        throw makeError(
          `BUILTIN_NODE_RESOLUTION_FAIL`,
          `The builtin node resolution algorithm was unable to resolve the module referenced by "${request}" and requested from "${issuer}" (it didn't go through the pnp resolver because the issuer doesn't seem to be part of the Yarn-managed dependency tree)`,
          {
            request,
            issuer
          },
        );
      }

      return result;
    }

    const issuerInformation = getPackageInformationSafe(issuerLocator);

    // We obtain the dependency reference in regard to the package that request it

    let dependencyReference = issuerInformation.packageDependencies.get(dependencyName);

    // If we can't find it, we check if we can potentially load it from the packages that have been defined as potential fallbacks.
    // It's a bit of a hack, but it improves compatibility with the existing Node ecosystem. Hopefully we should eventually be able
    // to kill this logic and become stricter once pnp gets enough traction and the affected packages fix themselves.

    if (issuerLocator !== topLevelLocator) {
      for (let t = 0, T = fallbackLocators.length; dependencyReference === undefined && t < T; ++t) {
        const fallbackInformation = getPackageInformationSafe(fallbackLocators[t]);
        dependencyReference = fallbackInformation.packageDependencies.get(dependencyName);
      }
    }

    // If we can't find the path, and if the package making the request is the top-level, we can offer nicer error messages

    if (!dependencyReference) {
      if (dependencyReference === null) {
        if (issuerLocator === topLevelLocator) {
          throw makeError(
            `MISSING_PEER_DEPENDENCY`,
            `You seem to be requiring a peer dependency ("${dependencyName}"), but it is not installed (which might be because you're the top-level package)`,
            {request, issuer, dependencyName},
          );
        } else {
          throw makeError(
            `MISSING_PEER_DEPENDENCY`,
            `Package "${issuerLocator.name}@${issuerLocator.reference}" is trying to access a peer dependency ("${dependencyName}") that should be provided by its direct ancestor but isn't`,
            {request, issuer, issuerLocator: Object.assign({}, issuerLocator), dependencyName},
          );
        }
      } else {
        if (issuerLocator === topLevelLocator) {
          throw makeError(
            `UNDECLARED_DEPENDENCY`,
            `You cannot require a package ("${dependencyName}") that is not declared in your dependencies (via "${issuer}")`,
            {request, issuer, dependencyName},
          );
        } else {
          const candidates = Array.from(issuerInformation.packageDependencies.keys());
          throw makeError(
            `UNDECLARED_DEPENDENCY`,
            `Package "${issuerLocator.name}@${issuerLocator.reference}" (via "${issuer}") is trying to require the package "${dependencyName}" (via "${request}") without it being listed in its dependencies (${candidates.join(
              `, `,
            )})`,
            {request, issuer, issuerLocator: Object.assign({}, issuerLocator), dependencyName, candidates},
          );
        }
      }
    }

    // We need to check that the package exists on the filesystem, because it might not have been installed

    const dependencyLocator = {name: dependencyName, reference: dependencyReference};
    const dependencyInformation = exports.getPackageInformation(dependencyLocator);
    const dependencyLocation = path.resolve(__dirname, dependencyInformation.packageLocation);

    if (!dependencyLocation) {
      throw makeError(
        `MISSING_DEPENDENCY`,
        `Package "${dependencyLocator.name}@${dependencyLocator.reference}" is a valid dependency, but hasn't been installed and thus cannot be required (it might be caused if you install a partial tree, such as on production environments)`,
        {request, issuer, dependencyLocator: Object.assign({}, dependencyLocator)},
      );
    }

    // Now that we know which package we should resolve to, we only have to find out the file location

    if (subPath) {
      unqualifiedPath = path.resolve(dependencyLocation, subPath);
    } else {
      unqualifiedPath = dependencyLocation;
    }
  }

  return path.normalize(unqualifiedPath);
};

/**
 * Transforms an unqualified path into a qualified path by using the Node resolution algorithm (which automatically
 * appends ".js" / ".json", and transforms directory accesses into "index.js").
 */

exports.resolveUnqualified = function resolveUnqualified(
  unqualifiedPath,
  {extensions = Object.keys(Module._extensions)} = {},
) {
  const qualifiedPath = applyNodeExtensionResolution(unqualifiedPath, {extensions});

  if (qualifiedPath) {
    return path.normalize(qualifiedPath);
  } else {
    throw makeError(
      `QUALIFIED_PATH_RESOLUTION_FAILED`,
      `Couldn't find a suitable Node resolution for unqualified path "${unqualifiedPath}"`,
      {unqualifiedPath},
    );
  }
};

/**
 * Transforms a request into a fully qualified path.
 *
 * Note that it is extremely important that the `issuer` path ends with a forward slash if the issuer is to be
 * treated as a folder (ie. "/tmp/foo/" rather than "/tmp/foo" if "foo" is a directory). Otherwise relative
 * imports won't be computed correctly (they'll get resolved relative to "/tmp/" instead of "/tmp/foo/").
 */

exports.resolveRequest = function resolveRequest(request, issuer, {considerBuiltins, extensions} = {}) {
  let unqualifiedPath;

  try {
    unqualifiedPath = exports.resolveToUnqualified(request, issuer, {considerBuiltins});
  } catch (originalError) {
    // If we get a BUILTIN_NODE_RESOLUTION_FAIL error there, it means that we've had to use the builtin node
    // resolution, which usually shouldn't happen. It might be because the user is trying to require something
    // from a path loaded through a symlink (which is not possible, because we need something normalized to
    // figure out which package is making the require call), so we try to make the same request using a fully
    // resolved issuer and throws a better and more actionable error if it works.
    if (originalError.code === `BUILTIN_NODE_RESOLUTION_FAIL`) {
      let realIssuer;

      try {
        realIssuer = realpathSync(issuer);
      } catch (error) {}

      if (realIssuer) {
        if (issuer.endsWith(`/`)) {
          realIssuer = realIssuer.replace(/\/?$/, `/`);
        }

        try {
          exports.resolveToUnqualified(request, realIssuer, {extensions});
        } catch (error) {
          // If an error was thrown, the problem doesn't seem to come from a path not being normalized, so we
          // can just throw the original error which was legit.
          throw originalError;
        }

        // If we reach this stage, it means that resolveToUnqualified didn't fail when using the fully resolved
        // file path, which is very likely caused by a module being invoked through Node with a path not being
        // correctly normalized (ie you should use "node $(realpath script.js)" instead of "node script.js").
        throw makeError(
          `SYMLINKED_PATH_DETECTED`,
          `A pnp module ("${request}") has been required from what seems to be a symlinked path ("${issuer}"). This is not possible, you must ensure that your modules are invoked through their fully resolved path on the filesystem (in this case "${realIssuer}").`,
          {
            request,
            issuer,
            realIssuer
          },
        );
      }
    }
    throw originalError;
  }

  if (unqualifiedPath === null) {
    return null;
  }

  try {
    return exports.resolveUnqualified(unqualifiedPath);
  } catch (resolutionError) {
    if (resolutionError.code === 'QUALIFIED_PATH_RESOLUTION_FAILED') {
      Object.assign(resolutionError.data, {request, issuer});
    }
    throw resolutionError;
  }
};

/**
 * Setups the hook into the Node environment.
 *
 * From this point on, any call to `require()` will go through the "resolveRequest" function, and the result will
 * be used as path of the file to load.
 */

exports.setup = function setup() {
  // A small note: we don't replace the cache here (and instead use the native one). This is an effort to not
  // break code similar to "delete require.cache[require.resolve(FOO)]", where FOO is a package located outside
  // of the Yarn dependency tree. In this case, we defer the load to the native loader. If we were to replace the
  // cache by our own, the native loader would populate its own cache, which wouldn't be exposed anymore, so the
  // delete call would be broken.

  const originalModuleLoad = Module._load;

  Module._load = function(request, parent, isMain) {
    if (!enableNativeHooks) {
      return originalModuleLoad.call(Module, request, parent, isMain);
    }

    // Builtins are managed by the regular Node loader

    if (builtinModules.has(request)) {
      try {
        enableNativeHooks = false;
        return originalModuleLoad.call(Module, request, parent, isMain);
      } finally {
        enableNativeHooks = true;
      }
    }

    // The 'pnpapi' name is reserved to return the PnP api currently in use by the program

    if (request === `pnpapi`) {
      return pnpModule.exports;
    }

    // Request `Module._resolveFilename` (ie. `resolveRequest`) to tell us which file we should load

    const modulePath = Module._resolveFilename(request, parent, isMain);

    // Check if the module has already been created for the given file

    const cacheEntry = Module._cache[modulePath];

    if (cacheEntry) {
      return cacheEntry.exports;
    }

    // Create a new module and store it into the cache

    const module = new Module(modulePath, parent);
    Module._cache[modulePath] = module;

    // The main module is exposed as global variable

    if (isMain) {
      process.mainModule = module;
      module.id = '.';
    }

    // Try to load the module, and remove it from the cache if it fails

    let hasThrown = true;

    try {
      module.load(modulePath);
      hasThrown = false;
    } finally {
      if (hasThrown) {
        delete Module._cache[modulePath];
      }
    }

    // Some modules might have to be patched for compatibility purposes

    if (patchedModules.has(request)) {
      module.exports = patchedModules.get(request)(module.exports);
    }

    return module.exports;
  };

  const originalModuleResolveFilename = Module._resolveFilename;

  Module._resolveFilename = function(request, parent, isMain, options) {
    if (!enableNativeHooks) {
      return originalModuleResolveFilename.call(Module, request, parent, isMain, options);
    }

    const issuerModule = getIssuerModule(parent);
    const issuer = issuerModule ? issuerModule.filename : process.cwd() + '/';

    const resolution = exports.resolveRequest(request, issuer);
    return resolution !== null ? resolution : request;
  };

  const originalFindPath = Module._findPath;

  Module._findPath = function(request, paths, isMain) {
    if (!enableNativeHooks) {
      return originalFindPath.call(Module, request, paths, isMain);
    }

    for (const path of paths || []) {
      let resolution;

      try {
        resolution = exports.resolveRequest(request, path);
      } catch (error) {
        continue;
      }

      if (resolution) {
        return resolution;
      }
    }

    return false;
  };

  process.versions.pnp = String(exports.VERSIONS.std);

  if (process.env.ESY__NODE_BIN_PATH != null) {
    const delimiter = require('path').delimiter;
    process.env.PATH = `${process.env.ESY__NODE_BIN_PATH}${delimiter}${process.env.PATH}`;
  }
};

exports.setupCompatibilityLayer = () => {
  // see https://github.com/browserify/resolve/blob/master/lib/caller.js
  const getCaller = () => {
    const origPrepareStackTrace = Error.prepareStackTrace;

    Error.prepareStackTrace = (_, stack) => stack;
    const stack = new Error().stack;
    Error.prepareStackTrace = origPrepareStackTrace;

    return stack[2].getFileName();
  };

  // ESLint currently doesn't have any portable way for shared configs to specify their own
  // plugins that should be used (https://github.com/eslint/eslint/issues/10125). This will
  // likely get fixed at some point, but it'll take time and in the meantime we'll just add
  // additional fallback entries for common shared configs.

  for (const name of [`react-scripts`]) {
    const packageInformationStore = packageInformationStores.get(name);
    if (packageInformationStore) {
      for (const reference of packageInformationStore.keys()) {
        fallbackLocators.push({name, reference});
      }
    }
  }

  // We need to shim the "resolve" module, because Liftoff uses it in order to find the location
  // of the module in the dependency tree. And Liftoff is used to power Gulp, which doesn't work
  // at all unless modulePath is set, which we cannot configure from any other way than through
  // the Liftoff pipeline (the key isn't whitelisted for env or cli options).

  patchedModules.set(/^resolve$/, realResolve => {
    const mustBeShimmed = caller => {
      const callerLocator = exports.findPackageLocator(caller);

      return callerLocator && callerLocator.name === 'liftoff';
    };

    const attachCallerToOptions = (caller, options) => {
      if (!options.basedir) {
        options.basedir = path.dirname(caller);
      }
    };

    const resolveSyncShim = (request, {basedir}) => {
      return exports.resolveRequest(request, basedir, {
        considerBuiltins: false,
      });
    };

    const resolveShim = (request, options, callback) => {
      setImmediate(() => {
        let error;
        let result;

        try {
          result = resolveSyncShim(request, options);
        } catch (thrown) {
          error = thrown;
        }

        callback(error, result);
      });
    };

    return Object.assign(
      (request, options, callback) => {
        if (typeof options === 'function') {
          callback = options;
          options = {};
        } else if (!options) {
          options = {};
        }

        const caller = getCaller();
        attachCallerToOptions(caller, options);

        if (mustBeShimmed(caller)) {
          return resolveShim(request, options, callback);
        } else {
          return realResolve.sync(request, options, callback);
        }
      },
      {
        sync: (request, options) => {
          if (!options) {
            options = {};
          }

          const caller = getCaller();
          attachCallerToOptions(caller, options);

          if (mustBeShimmed(caller)) {
            return resolveSyncShim(request, options);
          } else {
            return realResolve.sync(request, options);
          }
        },
        isCore: request => {
          return realResolve.isCore(request);
        }
      }
    );
  });
};

if (module.parent && module.parent.id === 'internal/preload') {
  exports.setupCompatibilityLayer();

  exports.setup();
}

if (process.mainModule === module) {
  exports.setupCompatibilityLayer();

  const reportError = (code, message, data) => {
    process.stdout.write(`${JSON.stringify([{code, message, data}, null])}\n`);
  };

  const reportSuccess = resolution => {
    process.stdout.write(`${JSON.stringify([null, resolution])}\n`);
  };

  const processResolution = (request, issuer) => {
    try {
      reportSuccess(exports.resolveRequest(request, issuer));
    } catch (error) {
      reportError(error.code, error.message, error.data);
    }
  };

  const processRequest = data => {
    try {
      const [request, issuer] = JSON.parse(data);
      processResolution(request, issuer);
    } catch (error) {
      reportError(`INVALID_JSON`, error.message, error.data);
    }
  };

  if (process.argv.length > 2) {
    if (process.argv.length !== 4) {
      process.stderr.write(`Usage: ${process.argv[0]} ${process.argv[1]} <request> <issuer>\n`);
      process.exitCode = 64; /* EX_USAGE */
    } else {
      processResolution(process.argv[2], process.argv[3]);
    }
  } else {
    let buffer = '';
    const decoder = new StringDecoder.StringDecoder();

    process.stdin.on('data', chunk => {
      buffer += decoder.write(chunk);

      do {
        const index = buffer.indexOf('\n');
        if (index === -1) {
          break;
        }

        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);

        processRequest(line);
      } while (true);
    });
  }
}
