// Last time updated at 25th of March 2016

// Nedislav Denev - ndenev@sbnd.net
// MIT License    - www.WebRTC-Experiment.com/licence
// Documentation  - github.com/muaz-khan/WebRTC-Experiment/tree/master/Pluginfree-Screen-Sharing

var conference = function(config) {
    var self = {
            userToken: uniqueToken()
        },
        channels = '--',
        isbroadcaster,
        isGetNewRoom = true,
        participants = 0,с
        defaultSocket = {};

    var sockets = [];

    function openDefaultSocket() {
        defaultSocket = config.openSocket({
            onmessage: defaultSocketResponse,
            callback: function(socket) {
                defaultSocket = socket;
            }
        });
    }

    function defaultSocketResponse(response) {
        if (response.userToken == self.userToken) return;

        if (isGetNewRoom && response.roomToken && response.broadcaster) config.onRoomFound(response);

        if (response.newParticipant) onNewParticipant(response.newParticipant);

        if (response.userToken && response.joinUser == self.userToken && response.participant && channels.indexOf(response.userToken) == -1) {
            channels += response.userToken + '--';
            openSubSocket({
                isofferer: true,
                channel: response.channel || response.userToken,
                closeSocket: true
            });
        }
    }

    function openSubSocket(_config) {
        if (!_config.channel) return;
        var socketConfig = {
            channel: _config.channel,
            onmessage: socketResponse,
            onopen: function() {
                if (isofferer && !peer) initPeer();
                sockets[sockets.length] = socket;
            }
        };

        socketConfig.callback = function(_socket) {
            socket = _socket;
            this.onopen();
        };

        var socket = config.openSocket(socketConfig),
            isofferer = _config.isofferer,
            gotstream,
            htmlElement = document.createElement('video'),
            inner = {},
            peer;

        var peerConfig = {
            oniceconnectionstatechange: function(p) {
                if(!isofferer || peer.firedOnce) return;

                if(p.iceConnectionState == 'failed') {
                    peer.firedOnce = true;
                    config.oniceconnectionstatechange('failed');
                }

                if(p.iceConnectionState == 'connected' && p.iceGatheringState == 'complete' && p.signalingState == 'stable') {
                    peer.firedOnce = true;
                    config.oniceconnectionstatechange('connected');
                }
            },
            attachStream: config.attachStream,
            onICE: function(candidate) {
                socket && socket.send({
                    userToken: self.userToken,
                    candidate: {
                        sdpMLineIndex: candidate.sdpMLineIndex,
                        candidate: JSON.stringify(candidate.candidate)
                    }
                });
            },
            onRemoteStream: function(stream) {
                htmlElement[moz ? 'mozSrcObject' : 'src'] = moz ? stream : webkitURL.createObjectURL(stream);
                htmlElement.play();

                _config.stream = stream;
                afterRemoteStreamStartedFlowing();
            }
        };

        function initPeer(offerSDP) {
            if (!offerSDP) peerConfig.onOfferSDP = sendsdp;
            else {
                peerConfig.offerSDP = offerSDP;
                peerConfig.onAnswerSDP = sendsdp;
            }
            peer = RTCPeerConnection(peerConfig);
        }

        function afterRemoteStreamStartedFlowing() {
            gotstream = true;

            config.onRemoteStream({
                video: htmlElement
            });

            /* closing sub-socket here on the offerer side */
            if (_config.closeSocket) socket = null;
        }

        function sendsdp(sdp) {
            sdp = JSON.stringify(sdp);
            var part = parseInt(sdp.length / 3);

            var firstPart = sdp.slice(0, part),
                secondPart = sdp.slice(part, sdp.length - 1),
                thirdPart = '';

            if (sdp.length > part + part) {
                secondPart = sdp.slice(part, part + part);
                thirdPart = sdp.slice(part + part, sdp.length);
            }

            socket && socket.send({
                userToken: self.userToken,
                firstPart: firstPart
            });

            socket && socket.send({
                userToken: self.userToken,
                secondPart: secondPart
            });

            socket && socket.send({
                userToken: self.userToken,
                thirdPart: thirdPart
            });
        }

        function socketResponse(response) {
            if (response.userToken == self.userToken) return;
            if (response.firstPart || response.secondPart || response.thirdPart) {
                if (response.firstPart) {
                    inner.firstPart = response.firstPart;
                    if (inner.secondPart && inner.thirdPart) selfInvoker();
                }
                if (response.secondPart) {
                    inner.secondPart = response.secondPart;
                    if (inner.firstPart && inner.thirdPart) selfInvoker();
                }

                if (response.thirdPart) {
                    inner.thirdPart = response.thirdPart;
                    if (inner.firstPart && inner.secondPart) selfInvoker();
                }
            }

            if (response.candidate && !gotstream) {
                peer && peer.addICE({
                    sdpMLineIndex: response.candidate.sdpMLineIndex,
                    candidate: JSON.parse(response.candidate.candidate)
                });
            }

            if (response.left) {
                participants--;
                if (isofferer && config.onNewParticipant) config.onNewParticipant(participants);

                if (peer && peer.peer) {
                    peer.peer.close();
                    peer.peer = null;
                }
            }
        }

        var invokedOnce = false;

        function selfInvoker() {
            if (invokedOnce) return;

            invokedOnce = true;

            inner.sdp = JSON.parse(inner.firstPart + inner.secondPart + inner.thirdPart);
            if (isofferer && inner.sdp.type == 'answer') {
                peer.addAnswerSDP(inner.sdp);
                participants++;
                if (config.onNewParticipant) config.onNewParticipant(participants);
            } else initPeer(inner.sdp);
        }
    }

    function leave() {
        var length = sockets.length;
        for (var i = 0; i < length; i++) {
            var socket = sockets[i];
            if (socket) {
                socket.send({
                    left: true,
                    userToken: self.userToken
                });
                delete sockets[i];
            }
        }

        // if owner leaves; try to remove his room from all other users side
        if (isbroadcaster) {
            defaultSocket.send({
                left: true,
                userToken: self.userToken,
                roomToken: self.roomToken
            });
        }

        if (config.attachStream) config.attachStream.stop();
    }

    window.addEventListener('beforeunload', function() {
        leave();
    }, false);

    window.addEventListener('keyup', function(e) {
        if (e.keyCode == 116)
            leave();
    }, false);

    function startBroadcasting() {
        defaultSocket && defaultSocket.send({
            roomToken: self.roomToken,
            roomName: self.roomName,
            broadcaster: self.userToken
        });
        setTimeout(startBroadcasting, 3000);
    }

    function onNewParticipant(channel) {
        if (!channel || channels.indexOf(channel) != -1 || channel == self.userToken) return;
        channels += channel + '--';

        var new_channel = uniqueToken();
        openSubSocket({
            channel: new_channel,
            closeSocket: true
        });

        defaultSocket.send({
            participant: true,
            userToken: self.userToken,
            joinUser: channel,
            channel: new_channel
        });
    }

    function uniqueToken() {
        return Math.random().toString(36).substr(2, 35);
    }

    openDefaultSocket();
    return {
        createRoom: function(_config) {
            self.roomName = _config.roomName || 'Anonymous';
            self.roomToken = uniqueToken();

            isbroadcaster = true;
            isGetNewRoom = false;
            startBroadcasting();
        },
        joinRoom: function(_config) {
            self.roomToken = _config.roomToken;
            isGetNewRoom = false;

            openSubSocket({
                channel: self.userToken
            });

            defaultSocket.send({
                participant: true,
                userToken: self.userToken,
                joinUser: _config.joinUser
            });
        }
    };
};

// Documentation - https://github.com/muaz-khan/WebRTC-Experiment/tree/master/RTCPeerConnection

// RTCPeerConnection-v1.5.js

var iceServers = [];

iceServers.push({
    url: 'stun:stun.l.google.com:19302'
});

iceServers.push({
    url: 'stun:stun.anyfirewall.com:3478'
});

iceServers.push({
    url: 'turn:turn.bistri.com:80',
    credential: 'homeo',
    username: 'homeo'
});

iceServers.push({
    url: 'turn:turn.anyfirewall.com:443?transport=tcp',
    credential: 'webrtc',
    username: 'webrtc'
});

iceServers = {
    iceServers: iceServers
};

/*

var iceFrame, loadedIceFrame;

function loadIceFrame(callback, skip) {
    if (loadedIceFrame) return;
    if (!skip) return loadIceFrame(callback, true);

    loadedIceFrame = true;

    var iframe = document.createElement('iframe');
    iframe.onload = function() {
        iframe.isLoaded = true;

        window.addEventListener('message', function(event) {
            if (!event.data || !event.data.iceServers) return;
            callback(event.data.iceServers);
        });

        iframe.contentWindow.postMessage('get-ice-servers', '*');
    };
    iframe.src = 'https://cdn.webrtc-experiment.com/getIceServers/';
    iframe.style.display = 'none';
    (document.body || document.documentElement).appendChild(iframe);
};

loadIceFrame(function(_iceServers) {
    iceServers.iceServers = iceServers.iceServers.concat(_iceServers);
    console.log('ice-servers', JSON.stringify(iceServers.iceServers, null, '\t'));
});
*/

window.moz = !!navigator.mozGetUserMedia;

function RTCPeerConnection(options) {
    var w = window,
        PeerConnection = w.mozRTCPeerConnection || w.webkitRTCPeerConnection,
        SessionDescription = w.mozRTCSessionDescription || w.RTCSessionDescription,
        IceCandidate = w.mozRTCIceCandidate || w.RTCIceCandidate;

    var optional = {
        optional: []
    };

    if (!moz) {
        optional.optional = [{
            DtlsSrtpKeyAgreement: true
        }];
    }

    var peer = new PeerConnection(iceServers, optional);

    peer.onicecandidate = function(event) {
        if (event.candidate)
            options.onICE(event.candidate);
    };

    // attachStream = MediaStream;
    if (options.attachStream) peer.addStream(options.attachStream);

    // attachStreams[0] = audio-stream;
    // attachStreams[1] = video-stream;
    // attachStreams[2] = screen-capturing-stream;
    if (options.attachStreams && options.attachStream.length) {
        var streams = options.attachStreams;
        for (var i = 0; i < streams.length; i++) {
            peer.addStream(streams[i]);
        }
    }

    peer.onaddstream = function(event) {
        var remoteMediaStream = event.stream;

        // onRemoteStreamEnded(MediaStream)
        remoteMediaStream.onended = function() {
            if (options.onRemoteStreamEnded) options.onRemoteStreamEnded(remoteMediaStream);
        };

        // onRemoteStream(MediaStream)
        if (options.onRemoteStream) options.onRemoteStream(remoteMediaStream);

        console.debug('on:add:stream', remoteMediaStream);
    };

    var constraints = options.constraints || {
        optional: [],
        mandatory: {
            OfferToReceiveAudio: false,
            OfferToReceiveVideo: true
        }
    };

    // onOfferSDP(RTCSessionDescription)

    function createOffer() {
        if (!options.onOfferSDP) return;

        peer.createOffer(function(sessionDescription) {
            sessionDescription.sdp = setBandwidth(sessionDescription.sdp);
            peer.setLocalDescription(sessionDescription);
            options.onOfferSDP(sessionDescription);
        }, onSdpError, constraints);
    }

    // onAnswerSDP(RTCSessionDescription)

    function createAnswer() {
        if (!options.onAnswerSDP) return;

        //options.offerSDP.sdp = addStereo(options.offerSDP.sdp);
        peer.setRemoteDescription(new SessionDescription(options.offerSDP), onSdpSuccess, onSdpError);
        peer.createAnswer(function(sessionDescription) {
            sessionDescription.sdp = setBandwidth(sessionDescription.sdp);
            peer.setLocalDescription(sessionDescription);
            options.onAnswerSDP(sessionDescription);
        }, onSdpError, constraints);
    }

    function setBandwidth(sdp) {
        if (moz) return sdp;
        if (navigator.userAgent.toLowerCase().indexOf('android') > -1) return sdp;

        // removing existing bandwidth lines
        sdp = sdp.replace(/b=AS([^\r\n]+\r\n)/g, '');

        // "300kbit/s" for screen sharing
        sdp = sdp.replace(/a=mid:video\r\n/g, 'a=mid:video\r\nb=AS:300\r\n');

        return sdp;
    }

    peer.oniceconnectionstatechange = function() {
        options.oniceconnectionstatechange(peer);
    };

    createOffer();
    createAnswer();

    function onSdpSuccess() {}

    function onSdpError(e) {
        console.error('sdp error:', JSON.stringify(e, null, '\t'));
    }

    return {
        addAnswerSDP: function(sdp) {
            console.log('setting remote description', sdp.sdp);
            peer.setRemoteDescription(new SessionDescription(sdp), onSdpSuccess, onSdpError);
        },
        addICE: function(candidate) {
            console.log('adding candidate', candidate.candidate);

            peer.addIceCandidate(new IceCandidate({
                sdpMLineIndex: candidate.sdpMLineIndex,
                candidate: candidate.candidate
            }));
        },

        peer: peer
    };
}

// getUserMedia
var video_constraints = {
    mandatory: {},
    optional: []
};

function getUserMedia(options) {
    var n = navigator,
        media;
    n.getMedia = n.webkitGetUserMedia || n.mozGetUserMedia;
    n.getMedia(options.constraints || {
        audio: true,
        video: video_constraints
    }, streaming, options.onerror || function(e) {
        console.error(e);
    });

    function streaming(stream) {
        var video = options.video;
        if (video) {
            video[moz ? 'mozSrcObject' : 'src'] = moz ? stream : window.webkitURL.createObjectURL(stream);
            video.play();
        }
        options.onsuccess && options.onsuccess(stream);
        media = stream;
    }

    return media;
}

function intallFirefoxScreenCapturingExtension() {
    InstallTrigger.install({
        'Foo': {
            // URL: 'https://addons.mozilla.org/en-US/firefox/addon/enable-screen-capturing/',
            URL: 'https://addons.mozilla.org/firefox/downloads/file/355418/enable_screen_capturing_in_firefox-1.0.006-fx.xpi?src=cb-dl-hotness',
            toString: function() {
                return this.URL;
            }
        }
    });
}

// Muaz Khan     - https://github.com/muaz-khan
// MIT License   - https://www.webrtc-experiment.com/licence/
// Documentation - https://github.com/muaz-khan/WebRTC-Experiment/tree/master/Pluginfree-Screen-Sharing

var isWebRTCExperimentsDomain = document.domain.indexOf('webrtc-experiment.com') != -1;

var config = {
    openSocket: function(config) {
        var channel = config.channel || 'screen-capturing-' + location.href.replace( /\/|:|#|%|\.|\[|\]/g , '');
        var socket = new Firebase('https://webrtc.firebaseIO.com/' + channel);
        socket.channel = channel;
        socket.on("child_added", function(data) {
            config.onmessage && config.onmessage(data.val());
        });
        socket.send = function(data) {
            this.push(data);
        };
        config.onopen && setTimeout(config.onopen, 1);
        socket.onDisconnect().remove();
        return socket;
    },
    onRemoteStream: function(media) {
        var video = media.video;
        video.setAttribute('controls', true);
        videosContainer.insertBefore(video, videosContainer.firstChild);
        video.play();
        // rotateVideo(video);
    },
    onRoomFound: function(room) {
        if(location.hash.replace('#', '').length) {
            // private rooms should auto be joined.
            conferenceUI.joinRoom({
                roomToken: room.roomToken,
                joinUser: room.broadcaster
            });
            return;
        }

        var alreadyExist = document.getElementById(room.broadcaster);
        if (alreadyExist) return;

        if (typeof roomsList === 'undefined') roomsList = document.body;

        var tr = document.createElement('tr');
        tr.setAttribute('id', room.broadcaster);
        tr.innerHTML = '<td>' + room.roomName + '</td>' +
            '<td><button class="join" id="' + room.roomToken + '">Open Screen</button></td>';
        roomsList.insertBefore(tr, roomsList.firstChild);

        var button = tr.querySelector('.join');
        button.onclick = function() {
            var button = this;
            button.disabled = true;
            conferenceUI.joinRoom({
                roomToken: button.id,
                joinUser: button.parentNode.parentNode.id
            });
        };
    },
    onNewParticipant: function(numberOfParticipants) {
        document.title = numberOfParticipants + ' users are viewing your screen!';
        var element = document.getElementById('number-of-participants');
        if (element) {
            element.innerHTML = numberOfParticipants + ' users are viewing your screen!';
        }
    },
    oniceconnectionstatechange: function(state) {
        if(state == 'failed') {
            alert('Failed to bypass Firewall rules. It seems that target user did not receive your screen. Please ask him reload the page and try again.');
        }

        if(state == 'connected') {
            alert('A user successfully received your screen.');
        }
    }
};

function captureUserMedia(callback, extensionAvailable) {
    console.log('captureUserMedia chromeMediaSource', DetectRTC.screen.chromeMediaSource);

    var screen_constraints = {
        mandatory: {
            chromeMediaSource: DetectRTC.screen.chromeMediaSource,
            maxWidth: screen.width > 1920 ? screen.width : 1920,
            maxHeight: screen.height > 1080 ? screen.height : 1080
            // minAspectRatio: 1.77
        },
        optional: [{ // non-official Google-only optional constraints
            googTemporalLayeredScreencast: true
        }, {
            googLeakyBucket: true
        }]
    };

    // try to check if extension is installed.
    if(isChrome && isWebRTCExperimentsDomain && typeof extensionAvailable == 'undefined' && DetectRTC.screen.chromeMediaSource != 'desktop') {
        DetectRTC.screen.isChromeExtensionAvailable(function(available) {
            captureUserMedia(callback, available);
        });
        return;
    }

    if(isChrome && isWebRTCExperimentsDomain && DetectRTC.screen.chromeMediaSource == 'desktop' && !DetectRTC.screen.sourceId) {
        DetectRTC.screen.getSourceId(function(error) {
            if(error && error == 'PermissionDeniedError') {
                alert('PermissionDeniedError: User denied to share content of his screen.');
            }

            captureUserMedia(callback);
        });
        return;
    }

    // for non-www.webrtc-experiment.com domains
    if(isChrome && !isWebRTCExperimentsDomain && !DetectRTC.screen.sourceId) {
        window.addEventListener('message', function (event) {
            if (event.data && event.data.chromeMediaSourceId) {
                var sourceId = event.data.chromeMediaSourceId;

                DetectRTC.screen.sourceId = sourceId;
                DetectRTC.screen.chromeMediaSource = 'desktop';

                if (sourceId == 'PermissionDeniedError') {
                    return alert('User denied to share content of his screen.');
                }

                captureUserMedia(callback, true);
            }

            if (event.data && event.data.chromeExtensionStatus) {
                warn('Screen capturing extension status is:', event.data.chromeExtensionStatus);
                DetectRTC.screen.chromeMediaSource = 'screen';
                captureUserMedia(callback, true);
            }
        });
        screenFrame.postMessage();
        return;
    }

    if(isChrome && DetectRTC.screen.chromeMediaSource == 'desktop') {
        screen_constraints.mandatory.chromeMediaSourceId = DetectRTC.screen.sourceId;
    }

    var constraints = {
        audio: false,
        video: screen_constraints
    };

    if(!!navigator.mozGetUserMedia) {
        console.warn(Firefox_Screen_Capturing_Warning);
        constraints.video = {
            mozMediaSource: 'window',
            mediaSource: 'window',
            maxWidth: 1920,
            maxHeight: 1080,
            minAspectRatio: 1.77
        };
    }

    console.log( JSON.stringify( constraints , null, '\t') );

    var video = document.createElement('video');
    video.setAttribute('autoplay', true);
    video.setAttribute('controls', true);
    videosContainer.insertBefore(video, videosContainer.firstChild);

    getUserMedia({
        video: video,
        constraints: constraints,
        onsuccess: function(stream) {
            config.attachStream = stream;
            callback && callback();

            video.setAttribute('muted', true);
            // rotateVideo(video);
        },
        onerror: function() {
            if (isChrome && location.protocol === 'http:') {
                alert('Please test this WebRTC experiment on HTTPS.');
            } else if(isChrome) {
                alert('Screen capturing is either denied or not supported. Please install chrome extension for screen capturing or run chrome with command-line flag: --enable-usermedia-screen-capturing');
            }
            else if(!!navigator.mozGetUserMedia) {
                alert(Firefox_Screen_Capturing_Warning);
            }
        }
    });
}

/* on page load: get public rooms */
var conferenceUI = conference(config);

/* UI specific */
var videosContainer = document.getElementById("videos-container") || document.body;
var roomsList = document.getElementById('rooms-list');

document.getElementById('share-screen').onclick = function() {
    var roomName = document.getElementById('room-name') || { };
    roomName.disabled = true;
    captureUserMedia(function() {
        conferenceUI.createRoom({
            roomName: (roomName.value || 'Anonymous') + ' shared his screen with you'
        });
    });
    this.disabled = true;
};

// function rotateVideo(video) {
//     video.style[navigator.mozGetUserMedia ? 'transform' : '-webkit-transform'] = 'rotate(0deg)';
//     setTimeout(function() {
//         video.style[navigator.mozGetUserMedia ? 'transform' : '-webkit-transform'] = 'rotate(360deg)';
//     }, 1000);
// }

(function() {
    var uniqueToken = document.getElementById('unique-token');
    if (uniqueToken)
        if (location.hash.length > 2) uniqueToken.parentNode.parentNode.parentNode.innerHTML = '<h2 style="text-align:center;"><a href="' + location.href + '" target="_blank">Share this link</a></h2>';
        else uniqueToken.innerHTML = uniqueToken.parentNode.parentNode.href = '#' + (Math.random() * new Date().getTime()).toString(36).toUpperCase().replace( /\./g , '-');
})();

var Firefox_Screen_Capturing_Warning = 'Make sure that you are using Firefox Nightly and you enabled: media.getusermedia.screensharing.enabled flag from about:config page. You also need to add your domain in "media.getusermedia.screensharing.allowed_domains" flag.';

var screenFrame, loadedScreenFrame;

function loadScreenFrame(skip) {
    if(loadedScreenFrame) return;
    if(!skip) return loadScreenFrame(true);

    loadedScreenFrame = true;

    var iframe = document.createElement('iframe');
    iframe.onload = function () {
        iframe.isLoaded = true;
        console.log('Screen Capturing frame is loaded.');

        document.getElementById('share-screen').disabled = false;
        document.getElementById('room-name').disabled = false;
    };
    iframe.src = 'https://www.webrtc-experiment.com/getSourceId/';
    iframe.style.display = 'none';
    (document.body || document.documentElement).appendChild(iframe);

    screenFrame = {
        postMessage: function () {
            if (!iframe.isLoaded) {
                setTimeout(screenFrame.postMessage, 100);
                return;
            }
            console.log('Asking iframe for sourceId.');
            iframe.contentWindow.postMessage({
                captureSourceId: true
            }, '*');
        }
    };
};

if(!isWebRTCExperimentsDomain) {
    loadScreenFrame();
}
else {
    document.getElementById('share-screen').disabled = false;
    document.getElementById('room-name').disabled = false;
}


// todo: need to check exact chrome browser because opera also uses chromium framework
var isChrome = !!navigator.webkitGetUserMedia;

// DetectRTC.js - https://github.com/muaz-khan/WebRTC-Experiment/tree/master/DetectRTC
// Below code is taken from RTCMultiConnection-v1.8.js (http://www.rtcmulticonnection.org/changes-log/#v1.8)
var DetectRTC = {};

(function () {

    var screenCallback;

    DetectRTC.screen = {
        chromeMediaSource: 'screen',
        getSourceId: function(callback) {
            if(!callback) throw '"callback" parameter is mandatory.';
            screenCallback = callback;
            window.postMessage('get-sourceId', '*');
        },
        isChromeExtensionAvailable: function(callback) {
            if(!callback) return;

            if(DetectRTC.screen.chromeMediaSource == 'desktop') return callback(true);

            // ask extension if it is available
            window.postMessage('are-you-there', '*');

            setTimeout(function() {
                if(DetectRTC.screen.chromeMediaSource == 'screen') {
                    callback(false);
                }
                else callback(true);
            }, 2000);
        },
        onMessageCallback: function(data) {
            if (!(typeof data == 'string' || !!data.sourceId)) return;

            console.log('chrome message', data);

            // "cancel" button is clicked
            if(data == 'PermissionDeniedError') {
                DetectRTC.screen.chromeMediaSource = 'PermissionDeniedError';
                if(screenCallback) return screenCallback('PermissionDeniedError');
                else throw new Error('PermissionDeniedError');
            }

            // extension notified his presence
            if(data == 'rtcmulticonnection-extension-loaded') {
                if(document.getElementById('install-button')) {
                    document.getElementById('install-button').parentNode.innerHTML = '<strong>Great!</strong> <a href="https://chrome.google.com/webstore/detail/screen-capturing/ajhifddimkapgcifgcodmmfdlknahffk" target="_blank">Google chrome extension</a> is installed.';
                }
                DetectRTC.screen.chromeMediaSource = 'desktop';
            }

            // extension shared temp sourceId
            if(data.sourceId) {
                DetectRTC.screen.sourceId = data.sourceId;
                if(screenCallback) screenCallback( DetectRTC.screen.sourceId );
            }
        },
        getChromeExtensionStatus: function (callback) {
            if (!!navigator.mozGetUserMedia) return callback('not-chrome');

            var extensionid = 'ajhifddimkapgcifgcodmmfdlknahffk';

            var image = document.createElement('img');
            image.src = 'chrome-extension://' + extensionid + '/icon.png';
            image.onload = function () {
                DetectRTC.screen.chromeMediaSource = 'screen';
                window.postMessage('are-you-there', '*');
                setTimeout(function () {
                    if (!DetectRTC.screen.notInstalled) {
                        callback('installed-enabled');
                    }
                }, 2000);
            };
            image.onerror = function () {
                DetectRTC.screen.notInstalled = true;
                callback('not-installed');
            };
        }
    };

    // check if desktop-capture extension installed.
    if(window.postMessage && isChrome) {
        DetectRTC.screen.isChromeExtensionAvailable();
    }
})();

DetectRTC.screen.getChromeExtensionStatus(function(status) {
    if(status == 'installed-enabled') {
        if(document.getElementById('install-button')) {
            document.getElementById('install-button').parentNode.innerHTML = '<strong>Great!</strong> <a href="https://chrome.google.com/webstore/detail/screen-capturing/ajhifddimkapgcifgcodmmfdlknahffk" target="_blank">Google chrome extension</a> is installed.';
        }
        DetectRTC.screen.chromeMediaSource = 'desktop';
    }
});

window.addEventListener('message', function (event) {
    if (event.origin != window.location.origin) {
        return;
    }

    DetectRTC.screen.onMessageCallback(event.data);
});

console.log('current chromeMediaSource', DetectRTC.screen.chromeMediaSource);