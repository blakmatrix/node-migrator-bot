node-migrator-bot
======

[![build status](https://secure.travis-ci.org/blakmatrix/node-migrator-bot.png)](http://travis-ci.org/blakmatrix/node-migrator-bot)

I am a bot. 
I will help you migrate your codebase to node v0.8!  

Did you know that the "sys" module throws an error if your program
tries to require it in node v0.8? To help keep your code running, 
I automatically replaced `require(\'sys\')` with 
`require(\'util\')`.  

If you'd like to know more about these changes in node.js, take a look 
at https://github.com/joyent/node/commit/1582cf#L1R51 and 
https://github.com/joyent/node/blob/1582cfebd6719b2d2373547994b3dca5c8c569c0/ChangeLog#L51 .  

As for myself, I was written by your friendly neighborhood node ninjas 
at [Nodejitsu](http://nodejitsu.com), and you can find them at `#nodejitsu` 
on irc.freenode.net or with http://webchat.jit.su .  

Enjoy!,  
--node-migrator-bot



Example
=======

Edit config/config.json, enter in a github username, password, and your redis db info.

`node app.js repo https://github.com/blakmatrix/node-migrator-bot`

[![example output](http://i.imgur.com/xD4Cp.png)](http://i.imgur.com/xD4Cp.png)


Commands
=======


`node app.js use`
----------------

The bot will tell you how to use it.



`node app.js file <filename>`
----------------

The bot will look at the given file and make any changes if necessary.



`node app.js repo <folder or link to repo>`
----------------

The bot will look at the given input and if it is giving a folder location on a
local drive it will recursively make any necessary changes.  

If given a repository link https://github.com/user/repo it will atempt to fork 
the repo into its own github account as specified by the username and password 
settings. After forking it will download the repository, will create a new 
branch in it, check it out, make its changes. If there are changes, it commits 
them, then push commits back to github. It will then submit a pull request to 
the original author of the repository. Then preform local file clean up. On 
a successful pull request or if its determined there is nothing to commit the 
repository will be added to the redis database hash as defined in the config.



`node app.js user <username>`
----------------

The bot will look at the given user, and for every repo they own will act as 
if `node app.js repo <repo-link>` was called.



`node app.js npm`
----------------

The bot will generate a list of all the packages in npm that have github links,
 and then for each repository link will act as if 
 `node app.js repo <repo-link>` was called.



 `node app.js db`
----------------

Will list all the items in the redis db added by the bot.



Install
=======

Not in NPM yet...

```shell
git clone git@github.com:blakmatrix/node-migrator-bot.git`
cd node-migrator-bot
```

Test
====

`npm test`


license
=======

MIT/X11
