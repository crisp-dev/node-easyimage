var Q = require('q');
var exec = require('child_process').execFile;
var command = require('child_process').exec;
var path = require('path');
var fs = require('fs');
var mkdirp = require('mkdirp');

var BINARY_NAME = "gm";

// check if GraphicsMagick is available on the system
command((BINARY_NAME + ' convert -version'), function(err, stdout, stderr) {

	// GraphicsMagick is NOT available on the system, exit with download info
	if (err) {
		console.log(' GraphicsMagick Not Found'.red)
		console.log(' EasyImage requires GraphicsMagick to work. Install it from http://www.graphicsmagick.org/\n')
	}

})

var error_messages = {
	'path': 'Missing image paths.\nMake sure both source and destination files are specified.',
	'dim': 'Missing dimensions.\nSpecify the width atleast.',
	'restricted': 'The command you are trying to execute is prohibited.',
	'unsupported': 'File not supported.',
};

// execute a child process with a timeout
function exec_with_timeout(action, args, timeout, callback) {
	timeout = (timeout || 10000);

	var execTimeout = null;

	var child = exec(BINARY_NAME, [action].concat(args), function(err, stdout, stderr) {
		if (execTimeout !== null) {
			clearTimeout(execTimeout);

			execTimeout = null;
		}

		callback(err, stdout, stderr);
	});

	execTimeout = setTimeout(function() {
		execTimeout = null;

		// child process took too much time, kill it now
		child.kill("SIGKILL");
	}, timeout);
}

// general info function
function info(file) {

	var deferred = Q.defer();
	var parseSize = function(sizeString) {

		var unit = {
			i: 1,
			Ki: 1000,
			Mi: 1000000,            // =1000^2
			Gi: 1000000000,         // =1000^3
			Ti: 1000000000000       // =1000^4
		};

		var rx = /^(\d*\.?\d*)([KMGT]?i)$/;  // regex for extract the float value and its unit
		var sizeArray = rx.exec(sizeString);

		if (sizeArray) {
			return parseFloat(sizeArray[1]) * unit[sizeArray[2]];
		}

		return -1;
	};

	// %q = depth, %m = type, %w = width, %h = height, %b = rounded filesize in byte, %f = filename, %x = density
	var args = ['-format']
	args.push('%m %q %w %h %b %x %y %f')
	args.push(file)

	exec_with_timeout('identify', args, undefined, function(err, stdout, stderr) {
		var info = {};
		//console.log(stdout)
		//Basic error handling
		if (stdout) {
      var temp = stdout.replace(/PixelsPerInch/g, '').replace(/PixelsPerCentimeter/g, '').replace(/Undefined/g, '').split(/\s+/g);

			//Basic error handling:
			if (temp.length < 7) {
				deferred.reject(new Error(stderr || error_messages['unsupported']));
			} else {

				info.type    = temp[0].toLowerCase();
				info.depth   = parseInt(temp[1]);
				info.width   = parseInt(temp[2]);
				info.height  = parseInt(temp[3]);
				info.size    = parseSize(temp[4]);
				info.density = {
					x: parseFloat(temp[5]),
					y: parseFloat(temp[6]),
				};
				info.name    = temp.slice(7).join(' ').replace(/(\r\n|\n|\r)/gm, '').trim();
				info.path = file;

				if (stderr) {
					info.warnings = stderr.split('\n');
				}

				deferred.resolve(info);
			}
		} else {
			deferred.reject(new Error(stderr || error_messages['unsupported']));
		}
	});

	return deferred.promise;
}


// get basic information about an image file
exports.info = function(file) {
	return info(file);
};



function directoryCheck(options, success, failure) {

	var dstPath = options.dst;

	// clear format from path (if any set)
	if (dstPath.includes(":")) {
		dstPath = dstPath.split(":")[1];
	}

	var targetDir = path.dirname(dstPath);

	fs.exists(targetDir, function (exists) {
		if (exists) {
			success()
		}
		else {
			mkdirp(targetDir, function (error) {
				if (error) {
					failure(error)
				}
				else {
					success()
				}
			})
		}
	})
}

// resize an image
exports.resize = function(options) {

	var deferred = Q.defer();

	function imgResize() {

		if (options.src === undefined || options.dst === undefined) return deferred.reject(error_messages['path']);
		if (options.width === undefined) return deferred.reject(error_messages['dim']);

		options.height = options.height || options.width;

    var args = [options.src]

		if (options.flatten) {
			args.push('-flatten')
			if (options.background) {
				args.push('-background')
				args.push(options.background)
			}
		}
		else {
			if (options.background) {
				args.push('-background')
				args.push(options.background)
				args.push('-flatten')
			}
		}

		if (options.autoOrient) {
    	args.push('-auto-orient')
   	}
		if (options.strip) {
    	args.push('-strip')
   	}
    args.push('-resize')
    args.push(options.width + 'x' + options.height)
    if (options.neverEnlarge) {
      args[args.length-1] += '>';
    }
    if (options.ignoreAspectRatio) {
      args[args.length-1] += '!';
    }
    if (options.quality) {
    	args.push('-quality')
    	args.push(options.quality)
    }
 		if (options.background) {
			args.push('-background')
			args.push(options.background)
		}
    if (options.interlace) {
    	args.push('-interlace')
    	args.push(options.interlace)
    }
    args.push(options.dst)

		exec_with_timeout('convert', args, options.timeout, function(err, stdout, stderr) {
			if (err) deferred.reject(err);
			deferred.resolve(options.dst);
		});

	}

	directoryCheck(options, imgResize, deferred.reject)
	return deferred.promise;
};

// create thumbnails
exports.thumbnail = function(options) {

	var deferred = Q.defer();

	function imgThumbnail() {

		if (options.src === undefined || options.dst === undefined) return deferred.reject(error_messages['path']);
		if (options.width === undefined) return deferred.reject(error_messages['dim']);

		options.height = options.height || options.width;
		options.gravity = options.gravity || 'Center';
		options.x = options.x || 0;
		options.y = options.y || 0;

		info(options.src).then(function(original) {

			// dimensions come as strings, convert them to number
			original.width = +original.width;
			original.height = +original.height;

			var resizewidth = options.width;
			var resizeheight = options.height;

			if (original.width > original.height) { resizewidth = ''; }
			else if (original.height > original.width) { resizeheight = ''; }

	    var args = [options.src]

			if (options.flatten) {
				args.push('-flatten')
				if (options.background) {
					args.push('-background')
					args.push(options.background)
				}
			}
			else {
				if (options.background) {
					args.push('-background')
					args.push(options.background)
					args.push('-flatten')
				}
			}

			if (options.autoOrient) {
	    	args.push('-auto-orient')
	   	}
	    args.push('-gravity')
	    args.push(options.gravity)
	    args.push('-strip')
	    args.push('-thumbnail')
	    args.push(resizewidth + 'x' + resizeheight)
	    args.push('-crop')
	    args.push(options.width + 'x'+ options.height + '+' + options.x + '+' + options.y)
	    if (options.quality) {
	    	args.push('-quality')
	    	args.push(options.quality)
	    }
			if (options.background) {
				args.push('-background')
				args.push(options.background)
			}
	    if (options.interlace) {
	    	args.push('-interlace')
	    	args.push(options.interlace)
	    }
	    args.push(options.dst)

			exec_with_timeout('convert', args, options.timeout, function(err, stdout, stderr) {
				if (err) return deferred.reject(err);
				deferred.resolve(options.dst);
			});

		}, function (err) { deferred.reject(err); });

	}

	directoryCheck(options, imgThumbnail, deferred.reject)
	return deferred.promise;
};

// issue your own GraphicsMagick command
exports.exec = function(cmd) {

	var deferred = Q.defer();

	process.nextTick(function () {

		command((BINARY_NAME + " " + cmd), function(err, stdout, stderr) {
			if (err) return deferred.reject(err);
			deferred.resolve(stdout);
		});

	})

	return deferred.promise;
};
