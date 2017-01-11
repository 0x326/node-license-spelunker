#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const async = require('async');
const argv = require('yargs')
  .usage('Usage: $0 [dir/] -o [outputFile]')
  .option('output', {
      alias: 'o',
      describe: 'Output file'
    })
  .count('verbose')
  .alias('v', 'verbose')
  .argv;

const VERBOSE_LEVEL = argv.verbose;
const INFO_LEVEL = 1;
const DEBUG_LEVEL = 2;

let rootProjectPath;
if (argv.length > 0) {
  rootProjectPath = path.resolve(argv._[0]);
}
else {
  rootProjectPath = path.resolve('./');
}
if (VERBOSE_LEVEL >= 0) {
  console.log('Project Path', rootProjectPath);
}
let rootProjectPackage = require(path.join(rootProjectPath, 'package.json'));

let modules = [];
let recursiveLevel = 0;

/**
 * Recursively explores the dependencies of a given package
 * @param {Path} packagePath The path to the package to inspect
 * @return undefined
 */
function exploreDependencies(packagePath) {
  let package = require(path.join(packagePath, 'package.json'));
  let nodeModulesPath = path.join(packagePath, 'node_modules');
  recursiveLevel++;
  
  if (VERBOSE_LEVEL >= DEBUG_LEVEL) {
    console.log('package.json license', package.license);
  }

  fs.exists(nodeModulesPath, function (dirExists) {
    if (dirExists) {
      fs.readdir(nodeModulesPath, function (err, files) {
        if (err) {
          throw err;
        }
        let directories = [];

        files = files.map(f => path.join(nodeModulesPath, f));
        async.filter(files, isPackage, function(directories) {
          if (VERBOSE_LEVEL >= DEBUG_LEVEL) {
            console.log('module directories', directories);
          }
          directories.forEach(exploreDependencies);
        });
      });
    }
  });

  findLicenseText(packagePath, function (license) {
    modules.push({
      name: package.name,
      version: package.version,
      url: 'https://www.npmjs.com/package/' + package.name,
      localPath: path.relative(rootProjectPath, packagePath),
      pkgLicense: package.license,
      license: license
    });
    recursiveLevel--;

    if (recursiveLevel === 0) {
      let improperlyLicensedModules = modules.filter(m => m.license === 'NO LICENSE FILE' );
      let unlicensedModules = improperlyLicensedModules.filter(m => !m.pkgLicense );
      console.log('# LICENSE FILE REPORT FOR', rootProjectPackage.name);
      console.log('');
      console.log(modules.length, 'nested dependencies')
      console.log(improperlyLicensedModules.length, 'without identifiable license text')
      console.log(unlicensedModules.length, 'without even a package.json license declaration', '\n\n')
      modules.forEach(function(m) {
        console.log('##', m.name);
        console.log('');
        console.log(m.name + '@' + m.version);
        console.log(m.url);
        console.log(m.localPath);
        if (m.pkgLicense) {
          console.log('From package.json license property:', JSON.stringify(m.pkgLicense));
        }
        console.log('');
        console.log(m.license);
        console.log('');
      });
    }
  });
}

/**
 * Searches for license text within a given package
 * @param projectPath The path to the package which to search for a license
 * @param {Function} callback A function accepting a String argument: the license text
 * @return undefined
 */
function findLicenseText(projectPath, callback) {
  let possibleLicensePaths = [
    path.join(projectPath, 'LICENSE'),
    path.join(projectPath, 'LICENCE'),
    path.join(projectPath, 'LICENSE.md'),
    path.join(projectPath, 'LICENSE.txt'),
    path.join(projectPath, 'LICENSE-MIT'),
    path.join(projectPath, 'LICENSE-BSD'),
    path.join(projectPath, 'MIT-LICENSE.txt'),
    path.join(projectPath, 'Readme.md'),
    path.join(projectPath, 'README.md'),
    path.join(projectPath, 'README.markdown')
  ];

  let unlicense  = "NO LICENSE FILE";

  async.reduceRight(possibleLicensePaths, unlicense, function (license, licensePath, callback) {
    let isAReadme = (licensePath.toLowerCase().indexOf('/readme') > 0);

    // If we already found a licnese, don't bother looking at READMEs
    if (license !== unlicense && isAReadme) {
      return callback(null, license);
    }

    // Read license file
    fs.exists(licensePath, function (exists) {
      if (!exists) {
        return callback(null, license);
      }
      fs.readFile(licensePath, { encoding: 'utf8' }, function (err, text) {
        if (err) {
          console.error(err);
          return (err, license);
        }

        if (isAReadme) {
          let licenseExcerpt = text.match(/\n[# ]*license[ \t]*\n/i);
          if (licenseExcerpt) {
            if (VERBOSE_LEVEL >= DEBUG_LEVEL) {
              console.log(licenseExcerpt.input.substring(licenseExcerpt.index));
            }
            return callback(null, 'FROM README:\n' + licenseExcerpt.input.substring(licenseExcerpt.index));
          }
          else {
            // Nothing found in README
            return callback(null, license);
          }
        }

        // Update with file text
        return callback(null, text);
      });
      
    });
  }, function (err, license) {
    if (err) {
      return callback('ERROR FINDING LICENSE FILE ' + err );
    }
    callback(license);
  });
}

/**
 * Determines whether the given path contains a module by testing the existence of a `package.json` file
 * @param {String} dirPath The path to the directory
 * @param {Function} callback A function which accepts a boolean argument.
 *  It is true if the path points to a package (is a dir and contains a `package.json` file); False otherwise
 * @return undefined
 */
function isPackage(dirPath, callback) {
  let packageManifest = path.join(dirPath, 'package.json');
  fs.stat(dirPath, function (err, stat) {
    let isModuleDir = false;
    if (err) {
      console.error(err);
    }
    else if (stat.isDirectory()) {
      fs.access(packageManifest, fs.constants.F_OK, (err) => {
        // If there is no error, then the directory must contain a module
        isModuleDir = err === null;
      });
    }
    callback(isModuleDir);
  });
}

// Start exploring the root project
exploreDependencies(rootProjectPath);
