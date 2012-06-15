var flatiron = require('flatiron'),
    path     = require('path'),
    XRegExp  = require('xregexp').XRegExp,
    fs       = require('fs'),
    app      = flatiron.app;



app.config.file({ file: path.join(__dirname, 'config', 'config.json') });

app.use(flatiron.plugins.cli, {
  source: path.join(__dirname, 'lib', 'commands'),
  usage: [
    '',
    'node-migrator-bot - Migrate your old Node.js Repos',
    '',
    'Usage:',
    '',
    '    node-migrator-bot repo <myrepo> - Takes the URL link to your repository on',
    '                                      git hub, forks it, does its thing, then',
    '                                      initates a pull request',
    '    node-migrator-bot user <user>   - Takes a github username, forks all node.js',
    '                                      repositories, does its thing, then',
    '                                      initates a pull request on each repository',
    '    node-migrator-bot file <file>   - runs the bot on the file provided'
  ]
});

app.cmd('repo', function(){
  app.prompt.get('name', function (err, result) {
    app.log.info('repo on  '+result.name+'!');
  });
});

app.cmd('user', function(){
  app.prompt.get('name', function (err, result) {
    app.log.info('user is  '+result.name+'!');
  });
});

app.commands.file = function file(filename, cb) {
  var newFile;
  this.log.info('Attempting to open "' + filename + '"');
  newFile = getNewFile(filename, cb);
  app.log.info("Changes are comming!:\n"+newFile);
};

function getNewFile(filename, cb){
  fs.readFile(filename, function (err, data) {
    if (err) {
      return cb( err);
    }

    //app.log.info(data);
    //app.log.info("Regex");

    var re = /require\s*\(\s*['"]sys['"]\s*\)/g,
        reFull = /sys\s*=\s*require\s*\(\s*['"]sys['"]\s*\)/g,
        rePart = /sys\./g,
        replacement = "require('util')",
        replacementFull = "util = require('util')",
        replacementPart = 'util.',
        dataStr = data.toString();
        fixedDoc = '';

    if (XRegExp.test(dataStr, re)) {
      if (XRegExp.test(dataStr, reFull)) {
        fixedDoc = XRegExp.replace(XRegExp.replace(dataStr, rePart, replacementPart, 'all'), reFull, replacementFull, 'all');
      }
      else{
        fixedDoc = XRegExp.replace(dataStr, re, replacement, 'all');
      }
      return cb(null, fixedDoc);
    }
    else{
      //app.log.info('No '+'require(\'sys\')'.magenta.bold+' text found in file');
      return cb(null, fixedDoc);
    }
  });
}

app.start( function (err){
  if (err) {
    app.log.error(err.message || 'You didn\'t call any commands!');
    app.log.warn('NOT OK.');
    return process.exit(1);
  }
  app.log.info('node-migrator-bot'.grey + ' ok'.green.bold);
});

