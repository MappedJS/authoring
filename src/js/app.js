const PythonShell = require('python-shell');
const OS = require('os');
const fs = require('fs-extra');
const {
    shell
} = require('electron');
const pug = require('pug');
const connect = require('connect');
const serveStatic = require('serve-static');
const XLSX = require('xlsx');
const request = require('request');
const url = require('url');
const path = require('path');
const fis = require('fast-image-size');
const archiver = require('archiver');
const IMAGE_ICON_LIST = {};

/*global FileReaderJS,ImageFile*/
angular.module('authoringTool', ['components'])
    .controller('MainController', function($scope, $sce, $timeout, languageService, dataService, markerService, imgLoaderService, excelService) {

        $scope.languageService = languageService;
        $scope.imgLoaderService = imgLoaderService;
        $scope.markerService = markerService;
        $scope.excelService = excelService;

        $scope.dataService = dataService;
        $scope.step = 1;
        $scope.processing = false;

        $scope.projectWasLoaded = false;

        $scope.previewIsReady = false;

        $scope.selectedClusterImg = __dirname + "/project-template/cluster-marker.png";

        $scope.mapOpts = {
            projectname: "mjs-" + new Date().getMinutes(),
            clusterImage: {
                path: "img/cluster.png",
                size: [88, 66],
                offset: [-38, -65],
                text: {
                    offset: [-5, -8],
                    color: "#000",
                    font: "bold 16px Tahoma"
                }
            },
            bounds: {
               northWest: [59, -3],
               southEast: [43, 24]
            },
            aoiBounds: {
               northWest: [55.064, 5.849],
               southEast: [47.269, 15.021]
            },
            thumbnailSize: 10,
            tileSize: 512,
            minTileSize: 128,
            zoom: [0.2, 1.5],
            extension: "jpg",
            markerData: {}
        };

        $scope.tileSizes = [128, 256, 512, 1024];
        $scope.minTileSizes = [32, 64, 128, 256, 512];
        $scope.extensions = ["jpg", "png"];
        $scope.doNotOverwriteAoiBounds = false;

        $scope.wasSelected = () => {
            $scope.doNotOverwriteAoiBounds = true;
        };

        $scope.boundsChanged = () => {
            if (!$scope.doNotOverwriteAoiBounds) {
                $scope.mapOpts.aoiBounds = angular.copy($scope.mapOpts.bounds);
            }
        };

        $scope.projectLoaded = function(data) {
            if (data && data.files) {
                const currentFile = data.files[0].path;
                const content = fs.readJsonSync(currentFile);
                $scope.mapOpts = content;

                // import images
                for (var i = 0; i < content.imagefiles.length; i++) {
                    const tmpFile = content.imagefiles[i];
                    content.imagefiles[i] = new ImageFile({
                        filesize: tmpFile.filesize,
                        path: tmpFile.path,
                        name: tmpFile.name
                    });
                    content.imagefiles[i].b64 = tmpFile.b64;
                    content.imagefiles[i].load(() => {});
                }
                $scope.dataService.files = content.imagefiles;

                $scope.markerService.contentTypes = content.mServiceData.contentTypes;
                $scope.markerService.iconTypes = content.mServiceData.iconTypes;
                $scope.markerService.labelTemplate = content.mServiceData.labelTemplate;
                $scope.markerService.markerCount = content.mServiceData.markerCount;
                $scope.markerService.marker = content.mServiceData.marker;

                $scope.excelService.loadExcel(content.excelExportData);

                $scope.selectedClusterImg = content.selectedClusterImg;

                $scope.projectWasLoaded = true;

                $scope.$apply();
            }
        }

        $scope.markersDone = () => {
            $scope.markerService.getMarkerData(this.tmpDir, (markerData, templates) => {
                if (templates && Object.keys(templates).length > 0) {
                    $scope.mapOpts.sidebar = {
                        templates: {}
                    };
                    for (let template in templates) {
                        fs.copySync(__dirname + '/../node_modules/mjs-plugin/hbs/' + template + '.hbs', this.tmpDir + '/hbs/' + template + '.hbs', {
                            clobber: true
                        }, (err) => {
                            if (err) {
                                console.error(err);
                            }
                        });
                        $scope.mapOpts.sidebar.templates[template] = 'hbs/' + template + '.hbs';
                    }
                } else {
                    delete $scope.mapOpts.sidebar;
                }

                $scope.mapOpts.markerData = markerData;

                const opts = {
                    settings: {
                        aoiBounds: $scope.mapOpts.aoiBounds,
                        clusterImage: $scope.mapOpts.clusterImage,
                        bounds: $scope.mapOpts.bounds,
                        center: this.getCenterOfBounds($scope.mapOpts.aoiBounds),
                        container: ".mjs"
                    },
                    tilesData: $scope.mapOpts.tilesData,
                    markerData: $scope.mapOpts.markerData
                };
                if ($scope.mapOpts.sidebar) {
                    opts.settings.sidebar = $scope.mapOpts.sidebar;
                }
                var html = pug.renderFile(__dirname + '/project-template/index.pug', {
                    pretty: true,
                    options: opts
                });

                fs.writeFileSync(this.tmpDir + "index.html", html);
                document.getElementById("previewWebview").reload();
                $scope.markerService.selectedMarkerGroup = undefined;
            });
        };

        $scope.back = () => {
            if ($scope.step === 2) {
                $scope.previewIsReady = false;
                this.previewServer.close();
            }
            $scope.step--;
        };

        $scope.toContent = () => {
            $scope.step++;
        };

        $scope.exportHandler = function() {
            $timeout(function() {
                document.querySelector('#export-path').click();
            }, 0);
        };

        $scope.clear = (item) => {
            item.value = null;
        };

        $scope.export = (dir) => {
            const srcDirectory = this.tmpDir;
            const outputPath = dir.files[0].path + "/";
            fs.ensureDirSync(outputPath);

            const opts = {
                settings: {
                    aoiBounds: $scope.mapOpts.aoiBounds,
                    clusterImage: $scope.mapOpts.clusterImage,
                    bounds: $scope.mapOpts.bounds,
                    center: this.getCenterOfBounds($scope.mapOpts.aoiBounds),
                    container: ".mjs"
                },
                tilesData: $scope.mapOpts.tilesData,
                markerData: $scope.mapOpts.markerData
            };
            if ($scope.mapOpts.sidebar) {
                opts.settings.sidebar = $scope.mapOpts.sidebar;
            }

            fs.writeFileSync(srcDirectory + "data.json", JSON.stringify(opts));

            const exportSettings = Object.assign(
                {},
                {"selectedClusterImg": $scope.selectedClusterImg},
                $scope.mapOpts,
                {
                    "mServiceData": {
                        "contentTypes": $scope.markerService.contentTypes,
                        "markerCount": $scope.markerService.markerCount,
                        "iconTypes": $scope.markerService.iconTypes,
                        "labelTemplate": $scope.markerService.labelTemplate,
                        "marker": $scope.markerService.marker
                    }
                },
                {"imagefiles": $scope.dataService.files},
                {"excelExportData": $scope.excelService.xlsPath}
            );
            //console.log(this.filterAngular(exportSettings));
            const exPath = $scope.dataService.files[0].path.substring(0, $scope.dataService.files[0].path.lastIndexOf("/") + 1);

            fs.writeFileSync(exPath + "project.json", JSON.stringify(exportSettings, null, "\t"));

            const output = fs.createWriteStream(outputPath + ($scope.mapOpts.projectname || "export") + ".zip");
            const zipArchive = archiver('zip');
            output.on('close', function() {
                shell.showItemInFolder(outputPath);
            });
            zipArchive.pipe(output);
            zipArchive.bulk([{
                src: ['**/*'],
                cwd: srcDirectory,
                expand: true
            }]);
            zipArchive.finalize();
        };

        this.clusterPath = function() {
            const parsedPath = path.parse($scope.selectedClusterImg);
            return parsedPath.base;
        };

        $scope.clusterSelected = function(data) {
            const file = data.files[0].path;
            $scope.selectedClusterImg = file;
            $scope.mapOpts.clusterImage.path = "img/cluster" + path.parse($scope.selectedClusterImg).ext;
            $scope.$apply();
        };

        $scope.next = () => {
            $scope.processing = true;
            this.tmpDir = OS.tmpdir() + "/MappedJS/" + $scope.mapOpts.projectname + "/";
            fs.ensureDirSync(this.tmpDir);
            const allPaths = $scope.dataService.getPaths();
            var pyOptions = {
                args: [
                    ...['-i'],
                    ...$scope.dataService.getPaths(),
                    ...['-o', this.tmpDir],
                    ...['-p', 'tiles/'],
                    ...['-c', 'True'],
                    ...['-t', $scope.mapOpts.thumbnailSize],
                    ...['-s', $scope.mapOpts.tileSize],
                    ...['-m', $scope.mapOpts.minTileSize],
                    ...['-e', $scope.mapOpts.extension],
                    ...['-z', $scope.mapOpts.zoom[0], $scope.mapOpts.zoom[1]]
                ],
                scriptPath: this.tmpDir
            };

            fs.copySync(__dirname + '/../node_modules/mjs-imageslicer/imageslicer.py', pyOptions.scriptPath + "imageslicer.py");

            PythonShell.run('imageslicer.py', pyOptions, (err, res) => {
                if (err) {
                    console.error(err);
                }

                const clusterimg = path.parse($scope.selectedClusterImg);
                const clusterimgPathTo = this.tmpDir + "img/cluster" + clusterimg.ext;

                fs.copySync($scope.selectedClusterImg, clusterimgPathTo, {
                    clobber: true
                }, (err) => {
                    if (err) {
                        console.error(err);
                    }
                });

                const data = fs.readFileSync(this.tmpDir + "tilesData.json", {
                    encoding: "utf-8"
                });
                fs.unlinkSync(this.tmpDir + "tilesData.json");
                $scope.mapOpts.tilesData = JSON.parse(data);

                const opts = {
                    settings: {
                        aoiBounds: $scope.mapOpts.aoiBounds,
                        bounds: $scope.mapOpts.bounds,
                        clusterImage: $scope.mapOpts.clusterImage,
                        center: this.getCenterOfBounds($scope.mapOpts.aoiBounds),
                        container: ".mjs"
                    },
                    tilesData: $scope.mapOpts.tilesData,
                    markerData: $scope.mapOpts.markerData
                };
                var html = pug.renderFile(__dirname + '/project-template/index.pug', {
                    pretty: true,
                    options: opts
                });
                fs.writeFileSync(this.tmpDir + "index.html", html);
                fs.copySync(__dirname + "/../node_modules/mjs-plugin/img", this.tmpDir + "img/");
                fs.copySync(__dirname + "/../node_modules/mjs-plugin/dist/js/mappedJS.min.js", this.tmpDir + "mjs/js/mappedjs.min.js");
                fs.copySync(__dirname + "/../node_modules/mjs-plugin/dist/styles/mappedJS.min.css", this.tmpDir + "mjs/styles/mappedjs.min.css");

                //shell.showItemInFolder(this.tmpDir);

                this.previewServer = connect().use(serveStatic(this.tmpDir)).listen(8888, () => {
                    $scope.processing = false;
                    $scope.previewIsReady = true;
                    document.getElementById("previewWebview").reload();
                    $scope.step = 2;
                    $scope.$apply();
                });

                if ($scope.projectWasLoaded) {
                    $scope.markersDone();
                }

            });
        };

        this.getCenterOfBounds = function(b) {
            const lat = (b.northWest[0] + b.southEast[0]) / 2;
            const lng = (b.northWest[1] + b.southEast[1]) / 2;
            return {
                "lat": lat,
                "lng": lng
            };
        };

        $scope.hasFiles = function() {
            return $scope.dataService.hasFiles();
        };

        this.getLocale = function(word) {
            return $sce.trustAsHtml($scope.languageService.getWord(word));
        };

    })
    .controller('DataController', function($scope, $timeout, excelService, markerService) {
        $scope.excelService = excelService;
        $scope.markerService = markerService;

        $scope.clearData = function(data) {
            data.value = null;
        };

        $scope.dataSelected = function(data) {
            const currentFile = data.files[0].path;
            $scope.excelService.loadExcel(currentFile);
            $scope.$apply();
        };

        $scope.isSelected = (m) => {
            return $scope.markerService.selectedMarkerGroup === m;
        };

        $scope.deleteMarkerGroup = (m) => {
            let wasSelected = false;
            if (m === $scope.markerService.selectedMarkerGroup) {
                wasSelected = true;
            }
            $scope.markerService.removeGroup(m);
            if ($scope.markerService.marker.length === 0) {
                $scope.markerService.selectedMarkerGroup = undefined;
            } else {
                if (wasSelected) {
                    $scope.markerService.selectedMarkerGroup = $scope.markerService.marker[0];
                }
            }
        };

        $scope.createLabelGroup = (disabled) => {
            if (disabled) return false;
            $scope.markerService.selectedMarkerGroup = $scope.markerService.addGroup();
            $scope.markerService.changeType($scope.markerService.selectedMarkerGroup);
        };

        $scope.markerGroupSelected = (m) => {
            $scope.markerService.selectedMarkerGroup = m;
        };
    })
    .controller('MarkerController', function($scope, $timeout, markerService, excelService) {
        $scope.markerService = markerService;
        $scope.excelService = excelService;

        $scope.changePosition = (m, pos) => {
            const existInArray = m.columnPosition.indexOf(pos);
            if (existInArray < 0) {
                m.columnPosition.push(pos);
            } else {
                m.columnPosition.slice(existInArray, 1);
            }
        };

    })
    .controller('MapCreationController', function($scope, $timeout, dataService) {

        var fROpts = {
            dragClass: "drag",
            readAsDefault: "DataURL",
            accept: "image/(png|jpeg)",
            on: {
                beforestart: function(file) {
                    var imageFile = new ImageFile({
                        filesize: file.extra.prettySize,
                        path: file.path,
                        name: file.name
                    });
                    _this.addFile(imageFile);
                },
                load: function(e, file) {
                    for (var i in dataService.files) {
                        var currentFile = dataService.files[i];
                        if (currentFile.path === file.path) {
                            currentFile.addImageData(e.target.result);
                        }
                    }
                },
                error: function(e, file) {
                    console.error(e);
                },
                abort: function(e, file) {
                    console.error(e);
                },
                skip: function(e, file) {
                    console.error(e);
                },
                groupend: function(group) {
                    $timeout(function() {
                        for (var i in dataService.files) {
                            var current = dataService.files[i];
                            if (!current.isLoaded && !current.isLoading) {
                                current.load(function() {
                                    $scope.dataService.files.sort((file1, file2) => {
                                        return file1.width - file2.width;
                                    });
                                    $scope.$apply();
                                });
                            }
                        }
                    }, 800);
                }
            }
        };

        var _this = this;
        $scope.dataService = dataService;

        $scope.files = dataService.files;

        $scope.delete = function(i) {
            $scope.dataService.files.splice(i, 1);
        };

        this.init = function(elem) {
            $scope.upload = document.getElementById(elem);
            $scope.uploadInput = document.getElementById("input-" + elem);
            FileReaderJS.setupDrop($scope.upload, fROpts);
            FileReaderJS.setupInput($scope.uploadInput, fROpts);
            FileReaderJS.setSync(true);
        };

        this.uploadClickHandler = function() {
            $timeout(function() {
                document.querySelector('#input-upload').click();
            }, 0);
        };

        this.addFile = function(file) {
            $scope.dataService.files.push(file);
        };

    })
    .service("dataService", function() {
        this.files = [];

        this.hasFiles = function() {
            return this.files.length > 0;
        }

        this.getPaths = function() {
            var files = [];
            for (var i in this.files) {
                files.push(this.files[i].path);
            }
            return files;
        };
    })
    .service("excelService", function() {
        this.sheets = {};

        this.loadExcel = function(path) {
            const excelFile = XLSX.readFile(path);
            this.xlsPath = path;
            this.workbook = excelFile;
            this.sheets = {};
            this.header = [];
            this.body = {};
            this.sheetnames = excelFile["SheetNames"];
            for (const [i, name] of excelFile["SheetNames"].entries()) {
                const sheet = excelFile["Sheets"][name];
                this.sheets[name] = XLSX.utils.sheet_to_json(sheet, {
                    header: 1
                });
                this.body[name] = XLSX.utils.sheet_to_json(sheet);
                for (const [j, column] of this.sheets[name][0].entries()) {
                    this.header.push(name + ":" + column);
                }
            }
        };
    })
    .service("markerService", function(excelService, imgLoaderService) {
        this.marker = [];

        this.markerCount = 0;

        this.types = {
            "icon": {
                icon: {
                    type: "image",
                    offset: [0, 0],
                    url: ""
                }
            },
            "label": {
                text: {
                    color: "#333333",
                    offset: [0, 5],
                    align: "center",
                    baseline: "hanging",
                    font: ["normal", "400", 10, "Arial"]
                }
            },
            "icon & label": {
                text: {
                    color: "#333333",
                    offset: [0, 5],
                    align: "center",
                    baseline: "hanging",
                    font: ["normal", "400", 10, "Arial"]
                },
                icon: {
                    type: "image",
                    offset: [0, 0],
                    url: ""
                }
            }
        };

        this.iconTypes = [
            "image",
            "circle",
            "square"
        ];

        this.labelTemplate = {
            columnPosition: [],
            columnContent: "",
            columnURL: "",
            columnIconOffset: "",
            columnTextOffset: "",
            columnSize: "",
            id: "",
            sheet: []
        };

        this.addContent = () => {
            if (!this.selectedMarkerGroup.content) {
                this.selectedMarkerGroup.content = [];
            }
            if (!this.selectedMarkerGroup.newType) {
                this.selectedMarkerGroup.newType = [];
            }
            this.selectedMarkerGroup.content.push({
                type: "",
                content: {}
            });
        };

        this.contentTypes = [{
            type: "image",
            content: {
                "url": "",
                "caption": "",
                "credit": ""
            }
        }, {
            type: "text",
            content: {
                text: ""
            }
        }, {
            type: "list",
            content: {
                text: "",
                name: ""
            }
        }, {
            type: "iframe",
            content: {
                url: "",
                width: "",
                height: "",
                caption: "",
                credit: ""
            }
        }, {
            type: "crossheading",
            content: {
                text: ""
            }
        }, {
            type: "headline",
            content: {
                kicker: "",
                headline: "",
                subheadline: ""
            }
        }];

        this.addGroup = () => {
            const newGroup = angular.copy(this.labelTemplate);
            this.markerCount++;
            newGroup.id = "" + this.markerCount;
            newGroup.type = this.types["icon"];
            newGroup.sheet = excelService.sheetnames[0];
            this.marker.push(newGroup);
            return newGroup;
        };

        this.changeContentType = (a, i) => {
            a.content[i] = angular.copy(a.newType[i]);
        };

        this.deleteContent = (i) => {
            this.selectedMarkerGroup.content.splice(i, 1);
            this.selectedMarkerGroup.newType.splice(i, 1);
        };

        this.removeGroup = (m) => {
            for (const [i, marker] of this.marker.entries()) {
                if (marker === m) {
                    this.marker.splice(i, 1);
                }
            }
        };

        this.getMarkerData = (dir, cb) => {
            this.urlsToDownload = [];
            const producedMarkers = [];
            for (const [i, group] of this.marker.entries()) {
                const data = excelService.body[group.sheet];
                for (const entry of data) {
                    let currentMarker = {};
                    if (group.text) {
                        currentMarker = this.enrichText(currentMarker, group, entry);
                    }
                    if (group.icon) {
                        currentMarker = this.enrichIcon(currentMarker, group, entry, dir, i);
                    }
                    if (group.content) {
                        currentMarker = this.enrichContent(currentMarker, group, entry);
                    }
                    currentMarker = this.addPositionToMarker(currentMarker, group.columnPosition, entry);

                    producedMarkers.push(currentMarker);
                }
            }

            if (this.urlsToDownload.length === 0) {
                cb(producedMarkers, this.usedTemplates);
            } else {
                imgLoaderService.saveAllImagesLocally(this.urlsToDownload, dir, () => {
                    cb(producedMarkers, this.usedTemplates);
                });
            }
        };

        this.enrichText = (cm, group, entry) => {
            cm.text = angular.copy(group.text);
            cm.text.font[2] = cm.text.font[2] + "px";
            cm.text.font = cm.text.font.join(" ");
            cm.text.content = entry[group.columnContent];
            cm.text.offset = arrayToFloats(entry[group.columnTextOffset].split(","));
            return cm;
        };

        this.enrichContent = (cm, group, entry) => {
            this.usedTemplates = {};
            cm.content = [];
            for (const item of group.content) {
                if (!this.usedTemplates[item.type]) {
                    this.usedTemplates[item.type] = "";
                }
                const currItem = {
                    type: item.type,
                    content: {}
                };
                for (let contentType in item.content) {
                    currItem.content[contentType] = entry[item.content[contentType]];
                }
                cm.content.push(currItem);
            }
            return cm;
        };

        this.enrichIcon = (cm, group, entry, dir, i) => {
            cm.icon = angular.copy(group.icon);
            cm.icon.size = arrayToFloats(entry[group.columnSize].split(","));
            if (group.columnURL && group.columnURL !== "") {
                cm.icon.url = entry[group.columnURL];
                cm.icon.offset = arrayToFloats(entry[group.columnIconOffset].split(","));
                const loadUrl = url.parse(cm.icon.url);
                const parseFile = path.parse(cm.icon.url);
                if (parseFile.ext && parseFile.ext !== "") {
                    this.urlsToDownload.push({
                        url: loadUrl,
                        data: cm.icon
                    });
                }
            }
            return cm;
        };

        this.addPositionToMarker = (m, posNames, data) => {
            m.position = [];
            for (const pName of posNames) {
                const pos = data[pName].split(",");
                if (posNames.length === 1) {
                    m.position.push(parseFloat(pos[0]));
                    m.position.push(parseFloat(pos[1]));
                } else {
                    m.position.push([parseFloat(pos[0]), parseFloat(pos[1])]);
                }
            }
            return m;
        };

        this.changeType = (m) => {
            delete m.text;
            delete m.icon;
            if (m.type.text) m.text = angular.copy(m.type.text);
            if (m.type.icon) m.icon = angular.copy(m.type.icon);
        };

        this.changeIconType = (m) => {
            if (m.icon.type === "image") {
                delete m.icon.color;
                m.icon.url = "";
            } else {
                delete m.icon.url;
                m.icon.color = "#333333";
            }
        };

    })
    .service("imgLoaderService", function($http) {

        this.download = (u, i, dir, cb) => {
            let newPath = "";
            if (typeof IMAGE_ICON_LIST[u] === "string") {
                return cb(null, IMAGE_ICON_LIST[u]);
            }
            request(u, {
                encoding: 'binary'
            }, (error, response, body) => {
                let extension = "jpg";
                if (!error && response.statusCode === 200) {
                    if (response.headers["content-type"].includes("image")) {
                        extension = response.headers["content-type"].split("/")[1];
                    } else {
                        console.error("Header content-type was not corrent", response.headers["content-type"]);
                        cb(u, null);
                    }
                } else {
                    console.error(error);
                    cb(u, null);
                }
                newPath = 'icon_' + i + '.' + extension;
                fs.writeFileSync(dir + newPath, body, 'binary', (err) => {});
                IMAGE_ICON_LIST[u] = newPath;
                cb(null, newPath);
            });
        };

        this.copyFile = (u, i, dir, cb) => {
            let newPath = "";
            if (typeof IMAGE_ICON_LIST[u.href] === "string") {
                return cb(null, IMAGE_ICON_LIST[u.href]);
            }
            let errorOccured = true;
            if (u.path) {
                errorOccured = false;
                const copyPath = path.parse(u.path);
                if (copyPath.ext && copyPath.ext !== "") {
                    newPath = 'icon_' + i + copyPath.ext;
                    fs.copySync(u.path, dir + newPath, {
                        clobber: true
                    }, (err) => {
                        if (err) {
                            errorOccured = true;
                            console.error(err);
                        }
                    });
                } else {
                    errorOccured = true;
                    console.error("No extension found!");
                }
            }
            IMAGE_ICON_LIST[u.href] = newPath;
            (errorOccured) ? cb(u, null): cb(null, newPath);
        };

        this.saveAllImagesLocally = (array, dir, cb) => {

            this.failedUrls = [];
            const subdir = "img/";
            dir = dir + subdir;
            fs.ensureDirSync(dir);

            let filesToDownload = array.length;
            this.filesDownloaded = 0;

            for (const [i, u] of array.entries()) {
                const downloadURL = url.parse(u.url);

                if (!(downloadURL.href in IMAGE_ICON_LIST)) {
                    IMAGE_ICON_LIST[downloadURL.href] = false;
                } else {
                    u.data.url = IMAGE_ICON_LIST[downloadURL.href];
                }

                if (downloadURL.protocol && downloadURL.protocol.includes("http")) {
                    this.download(downloadURL.href, i, dir, (failedUrl, newURL) => {
                        u.data.url = subdir + newURL;
                        this.copyCallback(failedUrl, filesToDownload, cb);
                    });
                } else {
                    this.copyFile(downloadURL, i, dir, (failedUrl, newURL) => {
                        u.data.url = subdir + newURL;
                        this.copyCallback(failedUrl, filesToDownload, cb);
                    });
                }
            }
        };

        this.copyCallback = (failedUrl, filesToDownload, cb) => {
            if (failedUrl) {
                this.failedUrls.push(failedUrl);
            }
            this.filesDownloaded++;
            if (filesToDownload === this.filesDownloaded) {
                cb();
            }
        };
    })
    .service("languageService", function($http) {
        this.changeLanguage = function() {
            this.loadLanguage();
        };

        this.getUrl = function() {
            return this.path + this.activeLanguage + '.json';
        };

        this.getWord = function(word) {
            return (this.locale && this.locale[word]) ? this.locale[word] : "";
        };

        this.loadLanguage = function() {
            if (this.languages[this.activeLanguage].data) {
                this.locale = this.languages[this.activeLanguage].data;
            }
            var _this = this;
            $http.get(this.getUrl())
                .success(function(data) {
                    _this.languages[_this.activeLanguage].data = data;
                    _this.locale = _this.languages[_this.activeLanguage].data;
                })
                .error(function(error) {
                    console.log(error);
                });
        };

        this.path = "lang/";
        this.languages = {
            "en-EN": {
                short: "en-EN",
                name: "English"
            },
            "de-DE": {
                short: "de-DE",
                name: "Deutsch"
            }
        };

        this.defaultLanguage = this.languages['en-EN'].short;
        this.activeLanguage = this.defaultLanguage;
        this.loadLanguage();

    });

function arrayToFloats(a) {
    return a.map(function(item) {
        return parseFloat(item);
    });
}
