// ==UserScript==
// @name                WME Geometries
// @version             2.0
// @description         Import geometry files into Waze Map Editor. Supports GeoJSON, GML, WKT, KML and GPX.
// @match               https://www.waze.com/*/editor*
// @match               https://www.waze.com/editor*
// @match               https://beta.waze.com/*
// @exclude             https://www.waze.com/*user/*editor/*
// @require             https://cdnjs.cloudflare.com/ajax/libs/lz-string/1.4.4/lz-string.min.js
// @require             https://cdn.jsdelivr.net/npm/@tmcw/togeojson@6.0.0/dist/togeojson.umd.min.js
// @require             https://unpkg.com/@terraformer/wkt
// @require             https://cdn.jsdelivr.net/npm/gml2geojson/dist/gml2geojson.js
// @require             https://cdn.jsdelivr.net/npm/@turf/turf@7/turf.min.js
// @grant               none
// @author              Timbones
// @contributor         wlodek76
// @contributor         Twister-UK
// @namespace           https://greasyfork.org/users/3339
// @run-at              document-idle
// ==/UserScript==


"use strict";

// import { State, WmeSDK } from "wme-sdk-typings";
// import * as toGeoJSON from "@tmcw/togeojson";
// import * as Terraformer from "@terraformer/wkt";
// import * as turf from "@turf/turf";
// import { FeatureCollection, GeoJsonProperties, Geometry } from "geojson";

window.SDK_INITIALIZED.then(geometries);

function geometries() {
    type MapFormatTypes = "GEOJSON" | "KML" | "WKT" | "GML" | "GMX" | "GPX";
    // show labels using first attribute that starts or ends with 'name' (case insensitive regexp)
    var defaultLabelName = /^name|name$/;

    // each loaded file will be rendered with one of these colours in ascending order
    var colorList: Set<string> = new Set([
        "deepskyblue",
        "magenta",
        "limegreen",
        "orange",
        "teal",
        "navy",
        "maroon",
    ]);
    let usedColors: Set<string> = new Set();

    // Id of div element for Checkboxes:
    const checkboxListID = "geometries-cb-list-id";

    // -------------------------------------------------------------
    type GeometryLayers = Record<string, GeoJSON.Feature[]>;
    let geometryLayers: GeometryLayers = {};

    interface Parser {
        read: (content: string) => void;
        internalProjection: string;
        externalProjection: string;
    }

    let parser: Parser;

    enum Formats {
        GEOJSON = 0,
        KML = 1,
        WKT = 2,
        GML = 3,
        GMX = 4,
    }

    let formathelp: string = "GeoJSON, KML, WKT, GPX, GML";

    var layerindex: number = 0;
    let selectedAttrib: string = "";

    if (!window.getWmeSdk) {
        throw new Error("SDK is not installed");
    }
    const sdk: WmeSDK = window.getWmeSdk({
        scriptId: "wme-geometries",
        scriptName: "WME Geometries",
    });

    console.log(`SDK v ${sdk.getSDKVersion()} on ${sdk.getWMEVersion()} initialized`);

    // delayed initialisation
    sdk.Events.once({ eventName: "wme-map-data-loaded" }).then(() => {
        init();
    });

    // function processMapUpdateEvent() {
    //     if (Object.keys(geometryLayers).length === 0) return;
    //     for (const l in geometryLayers) {
    //         sdk.Map.removeLayer({ layerName: l });
    //         sdk.LayerSwitcher.removeLayerCheckbox({ name: l });
    //     }
    //     geometryLayers = {};
    //     loadLayers();
    // }
    // sdk.Events.on({ eventName: "wme-map-move-end", eventHandler: processMapUpdateEvent });
    // sdk.Events.on({ eventName: "wme-map-zoom-changed", eventHandler: processMapUpdateEvent });
    sdk.Events.on({
        eventName: "wme-layer-checkbox-toggled",
        eventHandler(payload) {
            sdk.Map.setLayerVisibility({ layerName: payload.name, visibility: payload.checked });
        },
    });

    class LayerStoreObj {
        fileContent: string;
        color: string;
        fileExt: string;
        fileName: string;
        formatType: MapFormatTypes;

        constructor(fileContent: string, color: string, fileext: string, filename: string) {
            this.fileContent = fileContent;
            this.color = color;
            this.fileExt = fileext;
            this.fileName = filename;
            this.formatType = <MapFormatTypes>fileext.toUpperCase();
        }
    }

    function loadLayers() {
        // Parse any locally stored layer objects
        let files: Record<string, File> = JSON.parse(localStorage.getItem("WMEGeoLayers") || "[]");
        for (const f in files) processGeometryFile(files[f]);
    }

    // add interface to Settings tab
    function init() {
        var geobox = document.createElement("div");
        geobox.style.paddingTop = "6px";

        console.group();
        let sidepanelAreas = $("#sidepanel-areas");
        sidepanelAreas.append(geobox);

        var geotitle = document.createElement("h4");
        geotitle.innerHTML = "Import Geometry File";
        geobox.appendChild(geotitle);

        geolist = document.createElement("ul");
        geobox.appendChild(geolist);

        var geoform = document.createElement("form");
        geobox.appendChild(geoform);

        var inputfile = document.createElement("input");
        inputfile.type = "file";
        inputfile.id = "GeometryFile";
        inputfile.title = ".geojson, .gml or .wkt";
        inputfile.addEventListener("change", addGeometryLayer, false);
        geoform.appendChild(inputfile);

        var notes = document.createElement("p");
        notes.style.marginTop = "12px";
        notes.innerHTML =
            `<b>Formats:</b> <span id="formathelp">${formathelp}</span><br> ` +
            "<b>Coords:</b> EPSG:4326, EPSG:4269, EPSG:3857";
        geoform.appendChild(notes);

        // var inputstate = document.createElement("input");
        // inputstate.type = "button";
        // inputstate.value = "Draw State Boundary";
        // inputstate.title = "Draw the boundary for the topmost state";
        // inputstate.onclick = drawStateBoundary;
        // geoform.appendChild(inputstate);

        var inputclear = document.createElement("input");
        inputclear.type = "button";
        inputclear.value = "Clear All";
        inputclear.style.marginLeft = "8px";
        inputclear.onclick = removeGeometryLayers;
        geoform.appendChild(inputclear);

        loadLayers();

        console.groupEnd();
    }

    function addFormat(format: string) {
        $("#formathelp")[0].innerText += ", " + format;
    }

    // function drawStateBoundary() {
    //     let topState: State | null = sdk.DataModel.States.getTopState();
    //     if (!topState) {
    //         console.info("WME Geometries: no state or geometry available, sorry");
    //         return;
    //     }

    //     var layerName = `(${topState.name})`;
    //     var layers = W.map.getLayersBy("layerGroup", "wme_geometry");
    //     for (var i = 0; i < layers.length; i++) {
    //         if (layers[i].name === "Geometry: " + layerName) {
    //             console.info("WME Geometries: current state already loaded");
    //             return;
    //         }
    //     }

    //     var geo = formats.GEOJSON.parseGeometry(topState.name);
    //     var json = formats.GEOJSON.write(geo);
    //     var obj = new layerStoreObj(json, "grey", "GEOJSON", layerName);
    //     parseFile(obj);
    // }

    // import selected file as a vector layer
    function addGeometryLayer() {
        // get the selected file from user
        var fileList = document.getElementById("GeometryFile");
        if (!fileList) return;
        var file = fileList.files[0];
        fileList.value = "";

        processGeometryFile(file);
    }

    function processGeometryFile(file) {
        if (colorList.size === 0) {
            console.error("Cannot add Any more Layers at this point");
        }
        var fileext: string | undefined = file?.name?.split(".").pop();
        var filename: string | undefined = file?.name?.replace("." + fileext, "");
        if (!file || !file?.name || !fileext || !filename) return;
        fileext = fileext ? fileext.toUpperCase() : "";

        // add list item
        var color: string | undefined = colorList.values().next().value;
        if (!color) {
            console.error("Cannot add Any more Layers at this point");
        }
        colorList.delete(color);
        usedColors.add(color);
        var fileitem = document.createElement("li");
        fileitem.id = file.name.toLowerCase();
        fileitem.style.color = color;
        fileitem.innerHTML = "Loading...";
        geolist.appendChild(fileitem);

        // check if format is supported
        let parser = {
            read: null,
            internalProjection: null,
            externalProjection: null,
        };
        if (!parser) {
            fileitem.innerHTML = fileext.toUpperCase() + " format not supported :(";
            fileitem.style.color = "red";
            return;
        }

        // read the file into the new layer, and update the localStorage layer cache
        var reader = new FileReader();
        reader.onload = (function (theFile: File) {
            return function (e: ProgressEvent<FileReader>) {
                var tObj = new LayerStoreObj(e.target.result, color, fileext, filename);
                parseFile(tObj);
                let filenames: Record<string, File> = JSON.parse(localStorage.getItem("WMEGeoLayers") || "[]");
                filenames[color] = theFile;
                localStorage.setItem("WMEGeoLayers", JSON.stringify(filenames));
            };
        })(file);

        reader.readAsText(file);
    }
    const layerConfig = {
        defaultRule: {
            styleContext: {
                strokeColor: (context) => {
                    let style = context?.feature?.properties?.style;
                    if (!style) return style;
                    return style?.strokeColor;
                },
                fillColor: (context) => {
                    let style = context?.feature?.properties?.style;
                    if (!style) return style;
                    return style?.fillColor;
                },
                labelOutlineColor: (context) => {
                    let style = context?.feature?.properties?.style;
                    if (!style) return style;
                    return style?.labelOutlineColor;
                },
                label: (context) => {
                    let style = context?.feature?.properties?.style;
                    if (!style) return style;
                    return style?.label;
                },
            },
            styleRules: [
                {
                    predicate: () => {
                        return true;
                    },
                    style: {
                        strokeColor: "${strokeColor}",
                        strokeOpacity: 0.75,
                        strokeWidth: 3,
                        fillColor: "${fillColor}",
                        fillOpacity: 0.1,
                        pointRadius: 6,
                        fontColor: "white",
                        labelOutlineColor: "${labelOutlineColor}",
                        labelOutlineWidth: 4,
                        labelAlign: "center",
                        label: "${label}",
                    },
                },
            ],
        },
    };

    // Renders a layer object
    function parseFile(layerObj: LayerStoreObj) {
        // add a new layer for the geometry
        var layerid = "wme_geometry_" + ++layerindex;
        sdk.Map.addLayer({
            layerName: layerid,
            styleRules: layerConfig.defaultRule.styleRules,
            styleContext: layerConfig.defaultRule.styleContext,
        });
        sdk.Map.setLayerVisibility({ layerName: layerid, visibility: true });
        sdk.LayerSwitcher.addLayerCheckbox({ name: layerid });
        let features: GeoJSON.Feature[] = [];
        switch (layerObj.formatType) {
            case "GEOJSON":
                let jsonObject: GeoJSON.FeatureCollection = JSON.parse(layerObj.fileContent);
                {
                    jsonObject = turf.flatten(jsonObject);
                    features = jsonObject.features;
                }
                geometryLayers[layerid] = features;
                break;
            case "KML":
                let kmlData = new DOMParser().parseFromString(layerObj.fileContent, "application/xml");
                let geoJson: GeoJSON.FeatureCollection<GeoJSON.Geometry | null, GeoJsonProperties> = toGeoJSON.kml(kmlData);
                {
                    geoJson = turf.flatten(geoJson);
                    features = geoJson.features;
                }
                geometryLayers[layerid] = features;
                break;
            case "GPX":
                let gpxData = new DOMParser().parseFromString(layerObj.fileContent, "application/xml");
                let gpxGeoGson: GeoJSON.FeatureCollection<GeoJSON.Geometry | null> = toGeoJSON.gpx(gpxData);
                {
                    gpxGeoGson = turf.flatten(gpxGeoGson);
                    features = gpxGeoGson.features;
                }
                geometryLayers[layerid] = features;
                break;
            case "WKT":
                const wktGeoJson = Terraformer.wktToGeoJSON(layerObj.fileContent);
                switch (wktGeoJson.type) {
                    case "Polygon":
                        features = [
                            {
                                type: "Feature",
                                properties: { name: layerObj.fileName },
                                geometry: wktGeoJson,
                            },
                        ];
                        break;
                    case "GeometryCollection":
                        features = [];
                        for (let g in wktGeoJson.geometries) {
                            features.push({
                                type: "Feature",
                                properties: { name: layerObj.fileName },
                                geometry: wktGeoJson.geometries[g],
                            });
                        }
                        break;
                    default:
                        let errorMessage = "Unknown Type has been Encountered";
                        console.error(errorMessage);
                        throw Error(errorMessage);
                        break;
                }
                break;
            case "GML":
                // let gmlData = new DOMParser().parseFromString(layerObj.fileContent, "application/xml");
                let gmlGeoJSON: GeoJSON.FeatureCollection = gml2geojson.parseGML(layerObj.fileContent);
                {
                    gmlGeoJSON = turf.flatten(gmlGeoJSON);
                    features = gmlGeoJSON.features;
                }
                geometryLayers[layerid] = features;
                break;
            default:
                throw new Error(`Format Type: ${layerObj.formatType} is not implemented`);
        }

        // hack in translation:
        // I18n.translations[sdk.Settings.getLocale()].layers.name[layerid] = "WME Geometries: " + layerObj.filename;

        // if (/"EPSG:3857"|:EPSG::3857"/.test(layerObj.fileContent)) {
        //     parser.externalProjection = EPSG_3857;
        // }
        // else if (/"EPSG:4269"|:EPSG::4269"/.test(layerObj.fileContent)) {
        //     parser.externalProjection = EPSG_4269;
        // }
        // else default to EPSG:4326

        // load geometry files
        // var features = parser.read(layerObj.fileContent);

        // Append Div for Future Use for picking the Layer with Name
        let layersList = document.createElement("ul");
        layersList.className = "geometries-cb-list";
        layersList.id = checkboxListID;
        let trigger = null;
        // check we have features to render
        if (features.length > 0) {
            // check which attribute can be used for labels
            var labelWith: string = "(no labels)";
            for (const attrib in features[0].properties) {
                let attribLC = attrib.toLowerCase();
                let attribClassName = `geometries-${layerindex}-` +  attribLC;
                let attribIdName = `geometries-${layerindex}-` + attribLC;
                let listElement = document.createElement("li");
                let inputElement = document.createElement("input");
                inputElement.className = attribClassName;
                inputElement.id = attribIdName;
                inputElement.setAttribute("type", "radio");
                inputElement.setAttribute("name", `geometries-name-label-${layerindex}`);
                inputElement.textContent = attrib;
                listElement.appendChild(inputElement);
                let labelElement = document.createElement("label");
                labelElement.textContent = attrib;
                labelElement.className = "geometries-cb-label";
                labelElement.setAttribute("for", attribIdName);
                labelElement.style.color = "black";
                listElement.appendChild(labelElement);
                // let selectorString = "<li><input type=radio class='" + attribClassName + "' id='" +
                //     attribIdName + "' name='geometries-name-label'/>" +
                //     "<label class='geometries-cb-label'>" + attrib + "</label></li>"
                layersList.appendChild(listElement);
                $(inputElement).on("change", function (event: Event) {
                    addFeatures(features, event);
                });
                if (selectedAttrib && selectedAttrib === attrib) {
                    trigger = $(inputElement);
                } else if (!selectedAttrib && defaultLabelName.test(attribLC) === true) {
                    trigger = $(inputElement);
                }
            }
        }

        if (trigger) {
            trigger[0].checked = true;
            trigger.trigger("change");
        }

        function createClearButton(layerObj: LayerStoreObj, layerid: string): HTMLButtonElement {
            let clearButtonObject = document.createElement("button");
            clearButtonObject.textContent = "Clear Layer";
            clearButtonObject.name = "clear-" + (layerObj.fileName + "." + layerObj.fileExt).toLowerCase();
            clearButtonObject.id = "clear-" + layerid;
            clearButtonObject.className = "clear-layer-button";
            clearButtonObject.style.backgroundColor = layerObj.color;
            return clearButtonObject;
        }
        // When called as part of loading a new file, the list object will already have been created,
        // whereas if called as part of reloding cached data we need to create it here...
        var liObj = document.getElementById((layerObj.fileName + "." + layerObj.fileExt).toLowerCase());
        if (liObj === null) {
            liObj = document.createElement("li");
            liObj.id = (layerObj.fileName + "." + layerObj.fileExt).toLowerCase();
            liObj.style.color = layerObj.color;
            geolist.appendChild(liObj);
        }

        if (features.length === 0) {
            liObj.innerHTML = "No features loaded :(";
            liObj.style.color = "red";
        } else {
            liObj.innerHTML = layerObj.fileName;
            liObj.title =
                layerObj.fileExt.toUpperCase() +
                // " " +
                // parser.externalProjection.projCode +
                ": " +
                features.length +
                " features loaded\n" +
                labelWith;
            liObj.appendChild(layersList);
            let clearButtonObject = createClearButton(layerObj, layerid);
            liObj.appendChild(clearButtonObject);
            console.info("WME Geometries: Loaded " + liObj.title);
            $(".clear-layer-button").on("click", function () {
                let clearLayerId: string = this.id;
                clearLayerId = clearLayerId.replace("clear-", "");
                let clearListId: string | null | undefined = "";
                if (this.hasAttribute("name")) {
                    clearListId = this.getAttribute("name");
                    clearListId = clearListId?.replace("clear-", "");
                    if (clearListId) {
                        let elem = document.getElementById(clearListId);
                        elem?.remove();
                    }
                }
                sdk.Map.removeLayer({ layerName: clearLayerId });
                delete geometryLayers[clearLayerId];
                sdk.LayerSwitcher.removeLayerCheckbox({ name: clearLayerId });
                let listId: string | undefined = this.textContent?.replace("Clear ", "");
                if (!listId) return;
                let elementToRemove = document.getElementById(listId);
                elementToRemove?.remove();
                let files: Record<string, File> = JSON.parse(localStorage.getItem("WMEGeoLayers") || "[]");
                delete files[this.style.backgroundColor];
                localStorage.setItem("WMEGeoLayers", JSON.stringify(files));
                usedColors.delete(this.style.backgroundColor);
                colorList.add(this.style.backgroundColor);
                this.remove();
            });
        }

        function addFeatures(features: GeoJSON.Feature[], event: Event) {
            sdk.Map.removeAllFeaturesFromLayer({ layerName: layerid });
            selectedAttrib = event && event.target ? event.target.textContent : "";
            for (const f of features) {
                if (f.properties) {
                    labelWith = "Labels: " + selectedAttrib;
                    let layerStyle = {
                        strokeColor: layerObj.color,
                        fillColor: layerObj.color,
                        labelOutlineColor: layerObj.color,
                        label:
                            typeof f.properties[selectedAttrib] === "string"
                                ? `${f.properties[selectedAttrib]}`
                                : "undefined",
                    };
                    if (!f.properties?.style) f.properties.style = {};
                    Object.assign(f.properties.style, layerStyle);
                }

                if (!f.id) {
                    f.id = layerid + "_" + layerindex.toString();
                }
                if(f.geometry.type === "Polygon") {
                    let first = f.geometry.coordinates[0];
                    let last = f.geometry.coordinates[f.geometry.coordinates.length - 1];
                    if(first[0] != last[0] || first[1] !== last[1])
                        f.geometry.coordinates.push(f.geometry.coordinates[0]);
                }
                sdk.Map.addFeatureToLayer({ feature: f, layerName: layerid });
            }
        }
    }

    // clear all
    function removeGeometryLayers() {
        for (const l in geometryLayers) {
            sdk.Map.removeLayer({ layerName: l });
            sdk.LayerSwitcher.removeLayerCheckbox({ name: l });
        }

        geometryLayers = {};
        geolist.innerHTML = "";
        layerindex = 0;
        // Clear the cached layers
        localStorage.removeItem("WMEGeoLayers");
        for (const c in usedColors) {
            colorList.add(c);
        }
        usedColors.clear();
        return false;
    }

    // ------------------------------------------------------------------------------------

    // replace missing functions in OpenLayers 2.13.1
    // function patchOpenLayers() {
    //     console.group("WME Geometries: Patching missing features...");
    //     if (!OpenLayers.VERSION_NUMBER.match(/^Release [0-9.]*$/)) {
    //         console.error("WME Geometries: OpenLayers version mismatch (" + OpenLayers.VERSION_NUMBER + ") - cannot apply patch");
    //         return;
    //     }

    //     loadOLScript("lib/OpenLayers/Format/KML", function() {formats.KML = new OpenLayers.Format.KML(); addFormat("KML");} );
    //     loadOLScript("lib/OpenLayers/Format/GPX", function() {formats.GPX = new OpenLayers.Format.GPX(); addFormat("GPX");} );
    //     loadOLScript("lib/OpenLayers/Format/GML", function() {formats.GML = new OpenLayers.Format.GML(); addFormat("GML");} );
    //     console.groupEnd();
    // }
}
// // ------------------------------------------------------------------------------------

// // https://cdnjs.com/libraries/openlayers/x.y.z/
// function loadOLScript(filename, callback) {
//     var version = OpenLayers.VERSION_NUMBER.replace(/Release /, '');
//     console.info("Loading openlayers/" + version + "/" + filename + ".js");

//     var openlayers = document.createElement('script');
//     openlayers.src = "https://cdnjs.cloudflare.com/ajax/libs/openlayers/" + version + "/" + filename + ".js";
//     openlayers.type = "text/javascript";
//     openlayers.onload = callback;
//     document.head.appendChild(openlayers);
// }

// geometries();

// // ------------------------------------------------------------------------------------
