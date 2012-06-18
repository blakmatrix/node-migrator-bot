node-migrator-bot
======

Migrate your old Node.js Repos, Intended to change require('util') text to
require('util') as it has been changed in node v 0.3+.

[![build status](https://secure.travis-ci.org/blakmatrix/node-migrator-bot.png)](http://travis-ci.org/blakmatrix/node-migrator-bot)


methods
=======

`node app.js file <filename>`
----------------

The bot will look at the given file and make any changes if necessary.



`node app.js repo <folder or link to repo>`
----------------

The bot will look at the given input and if it is giving a folder location on a
local drive it will recursively make any necessary changes.  

If given a repository link https://github.com/user/repo it will atempt to for 
the repo into its own github account as specified by the username and password 
settings. After forking it will download the repository, will create a new 
branch in it, check it out, make its changes, commit them, then push back to 
github, and then finally will submit a pull request to the original author of 
the repository.



`node app.js user <username>`
----------------

The bot will look at the given user, and for every repo they own will act as 
if `node app.js repo <repo-link>` was called.




install
=======

Not in NPM yet...

license
=======

MIT/X11