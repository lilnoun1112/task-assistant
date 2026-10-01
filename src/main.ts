import { mount } from 'svelte';
import './app.css';
import Popup from './lib/ui/Popup.svelte';
import { app } from './lib/ui/state.svelte';

document.body.classList.add('popup');
mount(Popup, { target: document.getElementById('app')! });
void app.init();
