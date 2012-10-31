/*********************************************************************
 *
 * Software License Agreement (BSD License)
 *
 *  Copyright (c) 2012, Worcester Polytechnic Institute
 *  All rights reserved.
 *
 *  Redistribution and use in source and binary forms, with or without
 *  modification, are permitted provided that the following conditions
 *  are met:
 *
 *   * Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 *   * Redistributions in binary form must reproduce the above
 *     copyright notice, this list of conditions and the following
 *     disclaimer in the documentation and/or other materials provided
 *     with the distribution.
 *   * Neither the name of the Worcester Polytechnic Institute nor the 
 *     names of its contributors may be used to endorse or promote 
 *     products derived from this software without specific prior 
 *     written permission.
 *
 *  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 *  "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 *  LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS
 *  FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE
 *  COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,
 *  INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING,
 *  BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 *  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 *  CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
 *  LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN
 *  ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 *  POSSIBILITY OF SUCH DAMAGE.
 *
 *   Author: Russell Toris
 *  Version: October 8, 2012
 *  
 *  Converted to AMD by Jihoon Lee
 *  Version: September 27, 2012
 *
 *********************************************************************/

(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([ 'eventemitter2', 'actionclient', 'map' ], factory);
  } else {
    root.Nav2D = factory(root.EventEmitter2, root.ActionClient, root.Map);
  }
}
    (
        this,
        function(EventEmitter2, ActionClient, Map) {
          var Nav2D = function(options) {
            var nav2D = this;
            options = options || {};
            nav2D.ros = options.ros;
            nav2D.serverName = options.serverName || '/move_base';
            nav2D.actionName = options.actionName
                || 'move_base_msgs/MoveBaseAction';
            nav2D.serverTimeout = options.serverTimeout || 5000;
            nav2D.mapTopic = options.mapTopic || '/map';
            nav2D.continuous = options.continuous;
            nav2D.canvasID = options.canvasID;
            // optional (used if you do not want to stream /map or use a custom image)
            nav2D.image = options.image;
            nav2D.mapMetaTopic = options.mapMetaTopic || '/map_metadata';
            // optional color settings
            nav2D.clickColor = options.clickColor || '#543210';
            nav2D.robotColor = options.robotColor || '#012345';
            nav2D.initialPoseTopic = options.initialPoseTopic || '/initialpose';
            
            nav2D.mode = 'none';
            
            // current robot pose message
            nav2D.robotPose = null;
            // current goal
            nav2D.goalMessage = null;

            // icon information for displaying robot and click positions
            var clickRadius = 1;
            var clickUpdate = true;
            var maxClickRadius = 5;
            var robotRadius = 1;
            var robotRadiusGrow = true;
            var maxRobotRadius = 10;

            // position information
            var robotX;
            var robotY;
            var clickX;
            var clickY;

            // map and metadata
            var map;
            var mapWidth;
            var mapHeight;
            var mapResolution;
            var mapX;
            var mapY;
            var drawInterval;

            // flag to see if everything (map image, metadata, and robot pose) is available
            var available = false;

            // grab the canvas
            var canvas = document.getElementById(nav2D.canvasID);

            // check if we need to fetch a map or if an image was provided
            if (nav2D.image) {
              // set the image
              map = new Image();
              map.src = nav2D.image;

              // get the meta information
              var metaListener = new nav2D.ros.Topic({
                name : nav2D.mapMetaTopic,
                messageType : 'nav_msgs/MapMetaData'
              });
              metaListener.subscribe(function(metadata) {
                // set the metadata
                mapWidth = metadata.width;
                mapHeight = metadata.height;
                mapResolution = metadata.resolution;
                mapX = metadata.origin.position.x;
                mapY = metadata.origin.position.y;

                // we only need the metadata once
                metaListener.unsubscribe();
              });
            } else {
              // create a map object
              var mapFetcher = new Map({
                ros : nav2D.ros,
                mapTopic : nav2D.mapTopic,
                continuous : nav2D.continuous
              });
              mapFetcher.on('available', function() {
                // store the image
                map = mapFetcher.image;

                // set the metadata
                mapWidth = mapFetcher.info.width;
                mapHeight = mapFetcher.info.height;
                mapResolution = mapFetcher.info.resolution;
                mapX = mapFetcher.info.origin.position.x;
                mapY = mapFetcher.info.origin.position.y;
              });
            }

            // setup a listener for the robot pose
            var poseListener = new nav2D.ros.Topic({
              name : '/robot_pose',
              messageType : 'geometry_msgs/Pose',
              throttle_rate : 100,
            });
            poseListener
                .subscribe(function(pose) {
                  // set the public field
                  nav2D.robotPose = pose;
                  
                  // only update once we know the map metadata
                  if (mapWidth && mapHeight && mapResolution) {
                    // get the current canvas size
                    var canvasWidth = canvas.getAttribute('width');
                    var canvasHeight = canvas.getAttribute('height');

                    // set the pixel location with (0, 0) at the top left
                    robotX = ((pose.position.x - mapX) / mapResolution)
                        * (canvasWidth / mapWidth);
                    robotY = canvasHeight
                        - (((pose.position.y - mapY) / mapResolution) * (canvasHeight / mapHeight));

                    // check if this is the first time we have all information
                    if (!available) {
                      available = true;
                      // notify the user we are available
                      nav2D.emit('available');
                      // set the interval for the draw function
                      drawInterval = setInterval(draw, 30);
                    }
                  }
                });

            // setup the actionlib client
            var actionClient = new ActionClient({
              ros : nav2D.ros,
              actionName : nav2D.actionName,
              serverName : nav2D.serverName,
              timeout : nav2D.serverTimeout
            });
            // pass the event up
            actionClient.on('timeout', function() {
              nav2D.emit('timeout');
            });

            // create a cancel
            nav2D.cancel = function() {
              actionClient.cancel();
            };

            // create the draw function
            var draw = function() {
              // grab the drawing context
              var context = canvas.getContext('2d');

              // grab the current sizes
              var width = canvas.getAttribute('width');
              var height = canvas.getAttribute('height');

              // add the image back to the canvas
              context.drawImage(map, 0, 0, width, height);

              // check if the user clicked yet
              if (clickX && clickY && nav2D.mode == 'none') {
                // draw the click point
                context.fillStyle = nav2D.clickColor;
                context.beginPath();
                context.arc(clickX, clickY, clickRadius, 0, Math.PI * 2,
                    true);
                context.closePath();
                context.fill();

                // grow half the speed of the refresh rate
                if (clickUpdate) {
                  clickRadius++;
                }

                // reset at the threshold (i.e., blink)
                if (clickRadius == maxClickRadius) {
                  clickRadius = 1;
                }

                clickUpdate = !clickUpdate;
              }

              // draw the robot location
              context.fillStyle = nav2D.robotColor;
              context.beginPath();
              context.arc(robotX, robotY, robotRadius, 0, Math.PI * 2, true);
              context.closePath();
              context.fill();

              // grow and shrink the icon
              if (robotRadiusGrow) {
                robotRadius++;
              } else {
                robotRadius--;
              }
              if (robotRadius == maxRobotRadius || robotRadius == 1) {
                robotRadiusGrow = !robotRadiusGrow;
              }
            };

            // get the position in the world from a point clicked by the user
            nav2D.getPoseFromEvent = function(event) {
              // only go if we have the map data
              if (available) {
                // get the y location with (0, 0) at the top left
                var offsetLeft = 0;
                var offsetTop = 0;
                var element = canvas;
                while (element && !isNaN(element.offsetLeft)
                    && !isNaN(element.offsetTop)) {
                  offsetLeft += element.offsetLeft - element.scrollLeft;
                  offsetTop += element.offsetTop - element.scrollTop;
                  element = element.offsetParent;
                }
                clickX = event.pageX - offsetLeft;
                clickY = event.pageY - offsetTop;

                // convert the pixel location to a pose
                var canvasWidth = canvas.getAttribute('width');
                var canvasHeight = canvas.getAttribute('height');
                var x = (clickX * (mapWidth / canvasWidth) * mapResolution)
                    + mapX;
                var y = ((canvasHeight - clickY) * (mapHeight / canvasHeight) * mapResolution)
                    + mapY;
                return [ x, y ];
              } else {
                return null;
              }
            };

            // a function to send the robot to the given goal location
            nav2D.sendGoalPose = function(x, y) {
              // create a goal
              var goal = new actionClient.Goal({
                target_pose : {
                  header : {
                    frame_id : '/map'
                  },
                  pose : {
                    position : {
                      x : x,
                      y : y,
                      z : 0
                    },
                    orientation : {
                      x : 0,
                      y : 0,
                      z : 0.6,
                      w : 0.8
                    }
                  }
                }
              });
              goal.send();
              
              nav2D.goalMessage = goal.goalMessage;

              // pass up the events to the user
              goal.on('result', function(result) {
                nav2D.emit('result', result);
                nav2D.mode = 'none';

                // clear the click icon
                clickX = null;
                clickY = null;
              });
              goal.on('status', function(status) {
                nav2D.emit('status', status);
              });
              goal.on('feedback', function(feedback) {
                nav2D.emit('feedback', feedback);
              });
            };


           canvas.addEventListener('click',function(event) {
             if(nav2D.mode == 'none') {           }
             else if(nav2D.mode == 'init') 
             {
               var poses = nav2D.getPoseFromEvent(event);
               if (poses != null) {
                 nav2D.sendInitPose(poses[0], poses[1]);
               } else {
                 nav2D.emit('error',"All of the necessary navigation information is not yet available."); 
               }
             }
             else if(nav2D.mode == 'goal') {
               var poses = nav2D.getPoseFromEvent(event);
               if (poses != null) {
                 nav2D.sendGoalPose(poses[0], poses[1]);
               } else {
                 nav2D.emit('error',"All of the necessary navigation information is not yet available.");
               }
             }
             else {
               nav2D.emit('error',"Wrong mode..");
             }
             nav2D.mode = 'none';
            });

            nav2D.setmode = function(mode) {
              nav2D.mode = mode;
              clickX = null;
              clickY = null;
            };

            nav2D.initPosePub = new nav2D.ros.Topic({
              name : nav2D.initialPoseTopic,
              type : 'geometry_msgs/PoseWithCovarianceStamped',
            });

            nav2D.sendInitPose = function(x,y) {
              var pose_msg = new ros.Message({
                header : {
                    frame_id : '/map'
                },
                pose : {
                  pose : {
                    position: {
                      x : x,
                      y : y,
                      z : 0,
                    },
                    orientation : {
                      x : 0,
                      y : 0,
                      z : 0,
                      w : 1,
                    },
                  },
                  covariance: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
                },
              });
              nav2D.initPosePub.publish(pose_msg);
              nav2D.setmode('none');
            };

            canvas
                .addEventListener(
                    'dblclick',
                    function(event) {
                      var poses = nav2D.getPoseFromEvent(event);
                      if (poses != null) {
                        nav2D.sendGoalPose(poses[0], poses[1]);
                      } else {
                        nav2D
                            .emit('error',
                                "All of the necessary navigation information is not yet available.");
                      }
                    });
          };
          Nav2D.prototype.__proto__ = EventEmitter2.prototype;
          return Nav2D;
        }));
