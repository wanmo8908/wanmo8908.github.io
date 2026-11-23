import {initNeural} from './neural.js';

const motionPreference=window.matchMedia('(prefers-reduced-motion: reduce)');
let reduced=motionPreference.matches;
const heroCanvas=document.querySelector('#hero-neural');
const labCanvas=document.querySelector('#lab-neural');
let hero,lab;
try{hero=initNeural(heroCanvas,{mode:'interpret',labels:false,interactive:true,paused:reduced});lab=initNeural(labCanvas,{mode:'interpret',labels:true,interactive:true,paused:reduced});}catch(e){console.warn('Visual experience unavailable',e);document.querySelector('.lab-description').textContent='当前设备未能显示交互图。你仍可切换视角，阅读下方说明。';}

const descriptions={interpret:'观察节点之间的连接。移动鼠标改变视角，或轻触节点查看高亮。',safety:'注意高亮的局部信号与边界。一个细小的变化，也值得被理解。',quality:'沿着亮起的路径观察信息如何流动。从过程出发，寻找更好的方向。'};
document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{const mode=button.dataset.mode;lab?.setMode(mode);hero?.setMode(mode);document.querySelectorAll('[data-mode]').forEach(other=>{const active=other===button;other.classList.toggle('active',active);other.setAttribute('aria-pressed',String(active));});document.querySelector('#lab-description').textContent=descriptions[mode];}));
let paused=reduced;
const motion=document.querySelector('#motion-toggle');
function updateMotion(){motion.disabled=reduced;motion.textContent=reduced?'已遵循减少动态效果':paused?'开启动效':'暂停动效';motion.setAttribute('aria-pressed',String(paused));}
updateMotion();
motion.addEventListener('click',()=>{paused=!paused;hero?.setPaused(paused);lab?.setPaused(paused);updateMotion();});
motionPreference.addEventListener('change',event=>{reduced=event.matches;paused=reduced;hero?.setPaused(paused);lab?.setPaused(paused);updateMotion();});

const palette=document.querySelector('#command-palette');
document.querySelector('.command-trigger').addEventListener('click',()=>palette.showModal());
document.querySelector('#close-palette').addEventListener('click',()=>palette.close());
palette.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>palette.close()));
palette.addEventListener('click',event=>{if(event.target===palette){const b=palette.getBoundingClientRect();if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom)palette.close();}});
document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();palette.open?palette.close():palette.showModal();}});
const isMac=/Mac|iPhone|iPad/.test(navigator.platform);
document.querySelector('.command-trigger kbd').textContent=isMac?'⌘ K':'Ctrl K';
const progress=document.querySelector('.scroll-progress');let scheduled=false;
function updateProgress(){const range=document.documentElement.scrollHeight-innerHeight;progress.style.width=`${range>0?Math.min(100,Math.max(0,scrollY/range*100)):0}%`;scheduled=false;}
addEventListener('scroll',()=>{if(!scheduled){scheduled=true;requestAnimationFrame(updateProgress);}},{passive:true});
addEventListener('resize',updateProgress);updateProgress();
document.querySelector('#year').textContent=new Date().getFullYear();
