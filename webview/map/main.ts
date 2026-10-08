import "@vscode/codicons/dist/codicon.css";
import { mount } from "svelte";
import "../pulse/pulse.css";
import Map from "./Map.svelte";
import "./map.css";

mount(Map, { target: document.getElementById("app")! });
