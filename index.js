#!/usr/bin/env node

const argv = require('yargs')
  .usage('Usage: $0 [dir/] -o [outputFile]')
  .option('output', {
    alias: 'o',
    describe: 'Output file'
  })
  .option('end-of-line', {
    alias: 'eol',
    describe: 'Desired Line Endings',
    choices: ['lf', 'crlf', 'cr']
  })
  .count('verbose')
  .alias('v', 'verbose')
  .argv;
const os = require('os');
const path = require('path');
const fs = require('fs');
const async = require('async');
const steno = require('steno');

const VERBOSE_LEVEL = argv.verbose;
const INFO_LEVEL = 1;
const DEBUG_LEVEL = 2;

let rootProjectPath;
if (argv._.length > 0) {
  rootProjectPath = path.resolve(argv._[0]);
}
else {
  rootProjectPath = path.resolve('./');
}
if (VERBOSE_LEVEL >= 0) {
  console.log('Project Path', rootProjectPath);
  console.log('');
}
let rootProjectPackage = require(path.join(rootProjectPath, 'package.json'));

let desiredLineEndings;
if (argv['end-of-line']) {
  desiredLineEndings = argv['end-of-line'];
}
else if (os.EOL == '\r\n') {
  desiredLineEndings = 'CRLF';
}
else if (os.EOL == '\r') {
  desiredLineEndings = 'CR';
}
else {
  desiredLineEndings = 'LF';
}

const convertNewLines = require("convert-newline")(desiredLineEndings.toLowerCase()).string();

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
      let report = '# LICENSE FILE REPORT FOR ' + rootProjectPackage.name + '\n';
      console.log('%d licensed dependencies (including dependencies of dependencies)', modules.length);
      console.log('%d dependencies without license text but with license indicator', improperlyLicensedModules.length);
      console.log('%d unlicensed dependencies', unlicensedModules.length);
      console.log('');
      modules.forEach(module => {
        report += '## ' + module.name + '\n\n';
        if (VERBOSE_LEVEL >= INFO_LEVEL) {
          console.log(module.name + '@' + module.version);
          console.log(module.url);
          if (module.localPath.length > 0) {
            console.log(module.localPath);
          }
          if (module.pkgLicense) {
            console.log('From package.json license property:', JSON.stringify(module.pkgLicense));
          }
          console.log('');
        }
        report += module.license + '\n';
      });
      if (argv.output) {
        steno.writeFile(argv.output, report, err => {
          if (err) {
            console.error('Error writing file');
          }
        });
      }
      else {
        console.log(report);
      }
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

  let unlicense = "NO LICENSE FILE";

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
          return callback(err, license);
        }

        if (isAReadme) {
          let licenseExcerpt = text.match(/\n[# ]*license[ \t]*\n/i);
          if (licenseExcerpt) {
            if (VERBOSE_LEVEL >= DEBUG_LEVEL) {
              console.log(licenseExcerpt.input.substring(licenseExcerpt.index));
            }
            return callback(null, 'FROM README:\n' + convertNewLines(licenseExcerpt.input.substring(licenseExcerpt.index)));
          }
          else {
            // Nothing found in README
            return callback(null, license);
          }
        }

        // Update with file text
        return callback(null, convertNewLines(text));
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
