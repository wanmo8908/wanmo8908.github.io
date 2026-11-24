import {initNeural} from './neural.js';

const motionPreference=window.matchMedia('(prefers-reduced-motion: reduce)');
let reduced=motionPreference.matches;
const heroCanvas=document.querySelector('#hero-neural');
const labCanvas=document.querySelector('#lab-neural');
let hero,lab;
try{hero=initNeural(heroCanvas,{mode:'interpret',labels:false,interactive:true,paused:reduced});lab=initNeural(labCanvas,{mode:'interpret',labels:true,interactive:true,paused:reduced});}catch(e){console.warn('Visual experience unavailable',e);document.querySelector('.lab-description').textContent='The interactive visual is unavailable on this device. You can still switch perspectives and read the descriptions.';}

const descriptions={interpret:'Follow the connections. Move your pointer to change the view, or tap a node to highlight it.',safety:'Look for highlighted signals and boundaries. Even a small change deserves a closer look.',quality:'Follow the highlighted paths to see how information flows, and explore where it could go next.'};
document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{const mode=button.dataset.mode;lab?.setMode(mode);hero?.setMode(mode);document.querySelectorAll('[data-mode]').forEach(other=>{const active=other===button;other.classList.toggle('active',active);other.setAttribute('aria-pressed',String(active));});document.querySelector('#lab-description').textContent=descriptions[mode];}));
let paused=reduced;
const motion=document.querySelector('#motion-toggle');
function updateMotion(){motion.disabled=reduced;motion.textContent=reduced?'Reduced motion enabled':paused?'Resume motion':'Pause motion';motion.setAttribute('aria-pressed',String(paused));}
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

const copyBio=document.querySelector('#copy-bio');
copyBio.addEventListener('click',async()=>{
  const status=document.querySelector('#bio-status');
  const text=Array.from(document.querySelectorAll('.about-copy > p')).map(p=>p.innerText.trim()).join('\n\n');
  try{await navigator.clipboard.writeText(text);status.textContent='Bio copied';}
  catch{status.textContent='Could not copy. Please select the bio text above.';}
});
