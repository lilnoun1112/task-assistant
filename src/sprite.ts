import { mount } from 'svelte';
import './app.css';
import Sprite from './lib/ui/Sprite.svelte';

document.body.classList.add('sprite');
mount(Sprite, { target: document.getElementById('app')! });
