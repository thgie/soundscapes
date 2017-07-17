var app = {

    points: {},

    current_point:  0,
    next_point:     1,
    playing_points: [],

    min_position_accuracy:  30,
    location_watch:         undefined,
    compass_watch:          undefined,

    write_now:              true,

    walk_history: {
        type: "Feature",
        geometry: {
            type: "LineString",
            coordinates: []
        }
    },
    current_position:   undefined,
    current_heading:    0,

    initialize: function () {
        this.bind_events();
    },

    bind_events: function () {
        document.addEventListener('deviceready', this.on_device_ready, false);
    },

    on_device_ready: function () {

        var request = new XMLHttpRequest();
        request.open('GET', 'js/points.json', true);

        request.onload = function() {
            if (this.status >= 200 && this.status < 400) {
                app.points = JSON.parse(this.response).features;
                app.init_app();
            }
        };

        request.send();

    },

    init_app: function() {
        app.ui();
        app.init_location();

        setInterval(function(){
            app.write_now = true;
        }, 5000)

        // app.init_compass();
    },

    init_location: function () {
        if (app.location_watch) {
            navigator.geolocation.clearWatch(app.location_watch)
        }
        app.location_watch = navigator.geolocation.watchPosition(app.on_update, app.on_error, {
            timeout: 1000, enableHighAccuracy: true, maximumAge: 0
        });
    },
    init_compass: function () {
        if (app.compass_watch) {
            navigator.compass_watch.clearWatch(app.compass_watch);
        }
        app.compass_watch = navigator.compass_watch.watchHeading(app.on_compass_update, app.on_compass_error, {
            frequency: 100
        });
    },

    // start first file on click
    init_walk: function () {
        if (!app.points[0].properties.triggered) {
            app.play(app.points[0].properties.file);
        }
    },

    ui: function () {

        // keep screen and cpu alive
        window.plugins.insomnia.keepAwake();
        window.powermanagement.acquire();

        // app.create_dev_ui();

    },

    update_ui: function () {

        // app.update_dev_ui();

    },

    play: function (file) {
        if (app.playing_points.indexOf(file) == -1) {
            app.playing_points.push(file)
        }

        var trigger = app.get_trigger(file);

        trigger.properties.playing = true;
        trigger.properties.triggered = true;
        trigger.properties.media = new Media(app.media_url('audio/' + file + '.mp3'));
        trigger.properties.media.play();

        app.update_ui()
    },

    stop: function (file, cb) {
        if (app.playing_points.indexOf(file) !== -1) {
            app.playing_points.splice(app.playing_points.indexOf(file), 1)
        }

        var trigger = app.get_trigger(file);

        trigger.properties.media.stop();
        trigger.properties.media.release();
        trigger.properties.playing = false;

        app.update_ui();

        if (cb) cb()
    },

    fade: function (file, v) {
        if (v > 0.05) {
            app.get_trigger(file).properties.media.setVolume(v);
            setTimeout(function () {
                app.fade(file, v - 0.05)
            }, 200)
        } else {
            app.stop(file, function () {})
        }
    },

    on_update: function (position) {



        var indicator = document.querySelector('#indicator');

        // if we're withing acceptable accuracy make indicator clickable to init walk
        if (position.coords.accuracy > app.min_position_accuracy) {
            indicator.className = 'error';
            return;
        } else {
            indicator.className = 'ready';
            if (!app.points[0].properties.triggered) {
                indicator.addEventListener('click', function () {
                    app.init_walk();
                })
            }
        }

        document.querySelector('#accuracy').innerHTML = position.coords.accuracy;
        document.querySelector('#position').innerHTML = position.coords.latitude + " " + position.coords.longitude;
        app.current_position = {
            type: "Point",
            coordinates: [position.coords.longitude, position.coords.latitude]
        };
        if(app.write_now){
            app.write_now = false;
            app.walk_history.geometry.coordinates.push([position.coords.longitude, position.coords.latitude])
            /*if(app.walk_history.geometry.coordinates.length > 50){
                app.walk_history.geometry.coordinates.shift()
            }*/
        }

        app.log(
            app.walk_history.geometry.coordinates.length
        )



        // loop through all points
        for (var p in app.points) {
            var point = app.points[p];

            // if point isnt triggered check if we are within tolerance
            if (!point.properties.triggered) {
                app.trigger(p, point)
            }
        }
    },

    trigger: function (p, point) {

        if(point.geometry.type === "MultiPoint"){

            var distance = 99999;

            for (var c in point.geometry.coordinates) {
                var _distance = gju.pointDistance(
                    app.current_position,
                    { type: 'Point', coordinates: point.geometry.coordinates[c] }
                )
                if(_distance < distance) {
                    distance = _distance
                }
            }

            if (distance > point.properties.tolerance) return;
        }

        if(point.geometry.type === "Point"){

            var distance = gju.pointDistance(
                app.current_position,
                point.geometry
            )

            if (distance > point.properties.tolerance) return;
        }

        if(point.geometry.type === "LineString"){

            var intersect = gju.lineStringsIntersect (point.geometry, app.walk_history.geometry)
            if(!intersect) return;
        }



        // dev ui points row
        /*var row = document.getElementById(app.slugify(point.properties.file));
            row.querySelector('td.distance').innerHTML = distance;*/

        var current = app.points[p];

        // check if point depends on other points
        if (point.properties.depends) {

            if (!app.get_trigger(point.properties.depends).properties.triggered) {
                return;
            }
        }

        // fade out already playing files
        for (var r in app.playing_points) {
            app.fade(app.playing_points[r], 1)
        }

        app.current_point = p;
        if (p + 1 <= app.points.length - 1) {
            app.next_point = p + 1;
        }

        if(point.properties.file == 'T02') {
            app.walk_history.geometry.coordinates = [];
        }

        app.update_ui();
        app.play(point.properties.file);
    },

    on_error: function (error) {
        document.querySelector('#indicator').className = 'error';
    },

    // compass_watch towards next_point point
    on_compass_update: function (heading) {
        app.current_heading = heading.trueHeading >= 0 ? Math.round(heading.trueHeading) : Math.round(heading.magneticHeading);

        if (app.current_position) {
            var target = new LatLon(app.points[app.next_point].coordinates[0][1], app.points[app.next_point].coordinates[0][0]),
                target_bearing = Math.round(app.current_position.bearingTo(target)),
                diff = target_bearing - app.current_heading;

            document.querySelector('#bearing').innerHTML = diff;

            document.querySelector('#arrow').style.webkitTransform = "rotate(" + diff + "deg)";
            document.querySelector('#arrow').style.transform = "rotate(" + diff + "deg)";
        }
    },

    on_compass_error: function () {
        app.init_compass();
    },

    media_url: function (s) {
        if (device.platform.toLowerCase() === 'android') return '/android_asset/www/' + s;
        return s;
    },

    log: function (txt) {
        // document.getElementById('term').innerHTML = txt;
    },

    // get points object by file name
    get_trigger: function (file) {
        var obj;

        for (var t in app.points) {
            if (file === app.points[t].properties.file) {
                obj = app.points[t]
            }
        }

        return obj
    },

    // dev stuff

    slugify: function (txt) {
        return txt.toString().toLowerCase()
            .replace(/\s+/g, '-')           // Replace spaces with -
            .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
            .replace(/\-\-+/g, '-')         // Replace multiple - with single -
            .replace(/^-+/, '')             // Trim - from start of text
            .replace(/-+$/, '');            // Trim - from end of text
    },

    create_dev_ui: function () {

        var trigger_wrapper = document.getElementById('points');

        for (var t in app.points) {
            var params = app.points[t],
                wrapper = document.createElement('tr'),
                label = document.createElement('td'),
                distance = document.createElement('td'),
                triggered = document.createElement('td'),
                playing = document.createElement('td'),
                playstop = document.createElement('td'),
                button = document.createElement('button'),
                trigger = document.createElement('td'),
                button2 = document.createElement('button'),
                fade = document.createElement('td'),
                button3 = document.createElement('button');

            wrapper.appendChild(label);
            wrapper.appendChild(distance);
            wrapper.appendChild(triggered);
            wrapper.appendChild(playing);
            wrapper.appendChild(playstop);
            wrapper.appendChild(trigger);
            wrapper.appendChild(fade);

            playstop.appendChild(button);
            trigger.appendChild(button2);
            fade.appendChild(button3);

            label.className = 'label';
            distance.className = 'distance';
            triggered.className = 'triggered';
            playing.className = 'playing';
            playstop.className = 'playstop';
            trigger.className = 'trigger';
            fade.className = 'fade';

            trigger_wrapper.appendChild(wrapper);

            wrapper.id = app.slugify(params.file);

            label.innerHTML = params.file;
            button.dataset.file = params.file;
            button.dataset.trigger = t;
            button2.innerHTML = 'T';
            button2.dataset.file = params.file;
            button2.dataset.trigger = t;
            button3.innerHTML = '~';
            button3.dataset.file = params.file;
            button3.dataset.trigger = t;

            app.update_ui();

            button.addEventListener('click', function () {
                if (app.points[this.dataset.points].playing === false) {
                    app.points[this.dataset.points].playing = true;
                    app.play(this.dataset.file);
                } else {
                    app.points[this.dataset.points].playing = false;
                    app.stop(this.dataset.file, function () {
                    });
                }
                app.update_ui()
            });
            button2.addEventListener('click', function () {
                if (app.points[this.dataset.points].triggered) {
                    app.points[this.dataset.points].triggered = false
                } else {
                    app.points[this.dataset.points].triggered = true
                }
                app.update_ui()
            });
            button3.addEventListener('click', function () {
                app.fade(this.dataset.file, 1)
            })
        }
    },

    update_dev_ui: function () {
        for (var t in app.points) {

            var row = document.getElementById(app.slugify(app.points[t].file));

            if (row) {
                var playing = row.querySelector('td.playing'),
                    triggered = row.querySelector('td.triggered'),
                    button = row.querySelector('td.playstop button');

                if (app.points[t].playing) {
                    playing.innerHTML = 'x';
                    button.innerHTML = 'Stop';
                } else {
                    playing.innerHTML = '-';
                    button.innerHTML = 'Play';
                }

                if (app.points[t].triggered) {
                    triggered.innerHTML = 'x';
                } else {
                    triggered.innerHTML = '-';
                }
            }
        }
    }
};

app.initialize();
