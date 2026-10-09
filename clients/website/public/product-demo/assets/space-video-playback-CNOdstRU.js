import{gt as R,j as Y,c as Ka,r as Oe,gu as ko,gv as Ir,gw as Mo}from"./index-DMhlcCB3.js";const Lo=new Set(["style","children","ref","key","suppressContentEditableWarning","suppressHydrationWarning","dangerouslySetInnerHTML"]),wo={className:"class",htmlFor:"for"};function Ro(t){return t.toLowerCase()}function yr(t){if(typeof t=="boolean")return t?"":void 0;if(typeof t!="function"&&!(typeof t=="object"&&t!==null))return t}function D({react:t,tagName:e,elementClass:i,events:a,displayName:s,defaultProps:r,toAttributeName:o=Ro,toAttributeValue:d=yr}){const c=Number.parseInt(t.version)>=19,y=t.forwardRef((I,g)=>{const E=t.useRef(null),m=t.useRef(new Map),h={},v={},A={},T={};for(const[S,w]of Object.entries(I)){if(Lo.has(S)){A[S]=w;continue}const N=o(wo[S]??S);if(i.prototype&&S in i.prototype&&!(S in(globalThis.HTMLElement?.prototype??{}))&&!i.observedAttributes?.some(V=>V===N)){T[S]=w;continue}if(S.startsWith("on")){h[S]=w;continue}const z=d(w);if(N&&z!=null&&(v[N]=String(z),c||(A[N]=z)),N&&c){const V=yr(w);z!==V?A[N]=z:A[N]=w}}if(typeof window<"u"){for(const S in h){const w=h[S],N=S.endsWith("Capture"),z=(a?.[S]??S.slice(2).toLowerCase()).slice(0,N?-7:void 0);t.useLayoutEffect(()=>{const V=E?.current;if(!(!V||typeof w!="function"))return V.addEventListener(z,w,N),()=>{V.removeEventListener(z,w,N)}},[E?.current,w])}t.useLayoutEffect(()=>{if(E.current===null)return;const S=new Map;for(const w in T)Sr(E.current,w,T[w]),m.current.delete(w),S.set(w,T[w]);for(const[w,N]of m.current)Sr(E.current,w,void 0);m.current=S})}if(typeof window>"u"&&i?.getTemplateHTML&&i?.shadowRootOptions){const{mode:S,delegatesFocus:w}=i.shadowRootOptions,N=t.createElement("template",{shadowrootmode:S,shadowrootdelegatesfocus:w,dangerouslySetInnerHTML:{__html:i.getTemplateHTML(v,I)},key:"ce-la-react-ssr-template-shadow-root"});A.children=[N,A.children]}return t.createElement(e,{...r,...A,ref:t.useCallback(S=>{E.current=S,typeof g=="function"?g(S):g!==null&&(g.current=S)},[g])},A.children)});return y.displayName=s??i.name,y}function Sr(t,e,i){t[e]=i,i==null&&e in(globalThis.HTMLElement?.prototype??{})&&t.removeAttribute(e)}const p={MEDIA_PLAY_REQUEST:"mediaplayrequest",MEDIA_PAUSE_REQUEST:"mediapauserequest",MEDIA_MUTE_REQUEST:"mediamuterequest",MEDIA_UNMUTE_REQUEST:"mediaunmuterequest",MEDIA_LOOP_REQUEST:"medialooprequest",MEDIA_VOLUME_REQUEST:"mediavolumerequest",MEDIA_SEEK_REQUEST:"mediaseekrequest",MEDIA_AIRPLAY_REQUEST:"mediaairplayrequest",MEDIA_ENTER_FULLSCREEN_REQUEST:"mediaenterfullscreenrequest",MEDIA_EXIT_FULLSCREEN_REQUEST:"mediaexitfullscreenrequest",MEDIA_PREVIEW_REQUEST:"mediapreviewrequest",MEDIA_ENTER_PIP_REQUEST:"mediaenterpiprequest",MEDIA_EXIT_PIP_REQUEST:"mediaexitpiprequest",MEDIA_ENTER_CAST_REQUEST:"mediaentercastrequest",MEDIA_EXIT_CAST_REQUEST:"mediaexitcastrequest",MEDIA_SHOW_TEXT_TRACKS_REQUEST:"mediashowtexttracksrequest",MEDIA_HIDE_TEXT_TRACKS_REQUEST:"mediahidetexttracksrequest",MEDIA_SHOW_SUBTITLES_REQUEST:"mediashowsubtitlesrequest",MEDIA_DISABLE_SUBTITLES_REQUEST:"mediadisablesubtitlesrequest",MEDIA_TOGGLE_SUBTITLES_REQUEST:"mediatogglesubtitlesrequest",MEDIA_PLAYBACK_RATE_REQUEST:"mediaplaybackraterequest",MEDIA_RENDITION_REQUEST:"mediarenditionrequest",MEDIA_AUDIO_TRACK_REQUEST:"mediaaudiotrackrequest",MEDIA_SEEK_TO_LIVE_REQUEST:"mediaseektoliverequest",REGISTER_MEDIA_STATE_RECEIVER:"registermediastatereceiver",UNREGISTER_MEDIA_STATE_RECEIVER:"unregistermediastatereceiver"},P={MEDIA_CHROME_ATTRIBUTES:"mediachromeattributes",MEDIA_CONTROLLER:"mediacontroller"},rn={MEDIA_AIRPLAY_UNAVAILABLE:"mediaAirplayUnavailable",MEDIA_AUDIO_TRACK_ENABLED:"mediaAudioTrackEnabled",MEDIA_AUDIO_TRACK_LIST:"mediaAudioTrackList",MEDIA_AUDIO_TRACK_UNAVAILABLE:"mediaAudioTrackUnavailable",MEDIA_BUFFERED:"mediaBuffered",MEDIA_CAST_UNAVAILABLE:"mediaCastUnavailable",MEDIA_CHAPTERS_CUES:"mediaChaptersCues",MEDIA_CURRENT_TIME:"mediaCurrentTime",MEDIA_DURATION:"mediaDuration",MEDIA_ENDED:"mediaEnded",MEDIA_ERROR:"mediaError",MEDIA_ERROR_CODE:"mediaErrorCode",MEDIA_ERROR_MESSAGE:"mediaErrorMessage",MEDIA_FULLSCREEN_UNAVAILABLE:"mediaFullscreenUnavailable",MEDIA_HAS_PLAYED:"mediaHasPlayed",MEDIA_HEIGHT:"mediaHeight",MEDIA_IS_AIRPLAYING:"mediaIsAirplaying",MEDIA_IS_CASTING:"mediaIsCasting",MEDIA_IS_FULLSCREEN:"mediaIsFullscreen",MEDIA_IS_PIP:"mediaIsPip",MEDIA_LOADING:"mediaLoading",MEDIA_MUTED:"mediaMuted",MEDIA_LOOP:"mediaLoop",MEDIA_PAUSED:"mediaPaused",MEDIA_PIP_UNAVAILABLE:"mediaPipUnavailable",MEDIA_PLAYBACK_RATE:"mediaPlaybackRate",MEDIA_PREVIEW_CHAPTER:"mediaPreviewChapter",MEDIA_PREVIEW_COORDS:"mediaPreviewCoords",MEDIA_PREVIEW_IMAGE:"mediaPreviewImage",MEDIA_PREVIEW_TIME:"mediaPreviewTime",MEDIA_RENDITION_LIST:"mediaRenditionList",MEDIA_RENDITION_SELECTED:"mediaRenditionSelected",MEDIA_RENDITION_UNAVAILABLE:"mediaRenditionUnavailable",MEDIA_SEEKABLE:"mediaSeekable",MEDIA_STREAM_TYPE:"mediaStreamType",MEDIA_SUBTITLES_LIST:"mediaSubtitlesList",MEDIA_SUBTITLES_SHOWING:"mediaSubtitlesShowing",MEDIA_TARGET_LIVE_WINDOW:"mediaTargetLiveWindow",MEDIA_TIME_IS_LIVE:"mediaTimeIsLive",MEDIA_VOLUME:"mediaVolume",MEDIA_VOLUME_LEVEL:"mediaVolumeLevel",MEDIA_VOLUME_UNAVAILABLE:"mediaVolumeUnavailable",MEDIA_LANG:"mediaLang",MEDIA_WIDTH:"mediaWidth"},nn=Object.entries(rn),n=nn.reduce((t,[e,i])=>(t[e]=i.toLowerCase(),t),{}),Do={USER_INACTIVE_CHANGE:"userinactivechange",BREAKPOINTS_CHANGE:"breakpointchange",BREAKPOINTS_COMPUTED:"breakpointscomputed"},Ot=nn.reduce((t,[e,i])=>(t[e]=i.toLowerCase(),t),{...Do});Object.entries(Ot).reduce((t,[e,i])=>{const a=n[e];return a&&(t[i]=a),t},{userinactivechange:"userinactive"});const Co=Object.entries(n).reduce((t,[e,i])=>{const a=Ot[e];return a&&(t[i]=a),t},{userinactive:"userinactivechange"}),Ce={SUBTITLES:"subtitles",CAPTIONS:"captions",CHAPTERS:"chapters",METADATA:"metadata"},Ct={DISABLED:"disabled",SHOWING:"showing"},Ga={MOUSE:"mouse",PEN:"pen",TOUCH:"touch"},oe={UNAVAILABLE:"unavailable",UNSUPPORTED:"unsupported"},Ne={LIVE:"live",ON_DEMAND:"on-demand",UNKNOWN:"unknown"},Po={FULLSCREEN:"fullscreen"};function Oo(t){return t?.map(xo).join(" ")}function xo(t){if(t){const{id:e,width:i,height:a}=t;return[e,i,a].filter(s=>s!=null).join(":")}}function Uo(t){return t?.map(No).join(" ")}function No(t){if(t){const{id:e,kind:i,language:a,label:s}=t;return[e,i,a,s].filter(r=>r!=null).join(":")}}function ks(t){return typeof t=="number"&&!Number.isNaN(t)&&Number.isFinite(t)}const on=t=>new Promise(e=>setTimeout(e,t)),$o={"Start airplay":"Start airplay","Stop airplay":"Stop airplay",Audio:"Audio",Captions:"Captions","Enable captions":"Enable captions","Disable captions":"Disable captions","Start casting":"Start casting","Stop casting":"Stop casting","Enter fullscreen mode":"Enter fullscreen mode","Exit fullscreen mode":"Exit fullscreen mode",Mute:"Mute",Unmute:"Unmute",Loop:"Loop","Enter picture in picture mode":"Enter picture in picture mode","Exit picture in picture mode":"Exit picture in picture mode",Play:"Play",Pause:"Pause","Playback rate":"Playback rate","Playback rate {playbackRate}":"Playback rate {playbackRate}",Quality:"Quality","Seek backward":"Seek backward","Seek forward":"Seek forward",Settings:"Settings",Auto:"Auto","audio player":"audio player","video player":"video player",volume:"volume",seek:"seek","closed captions":"closed captions","current playback rate":"current playback rate","playback time":"playback time","media loading":"media loading",settings:"settings","audio tracks":"audio tracks",quality:"quality",play:"play",pause:"pause",mute:"mute",unmute:"unmute","chapter: {chapterName}":"chapter: {chapterName}",live:"live",Off:"Off","start airplay":"start airplay","stop airplay":"stop airplay","start casting":"start casting","stop casting":"stop casting","enter fullscreen mode":"enter fullscreen mode","exit fullscreen mode":"exit fullscreen mode","enter picture in picture mode":"enter picture in picture mode","exit picture in picture mode":"exit picture in picture mode","seek to live":"seek to live","playing live":"playing live","seek back {seekOffset} seconds":"seek back {seekOffset} seconds","seek forward {seekOffset} seconds":"seek forward {seekOffset} seconds","Network Error":"Network Error","Decode Error":"Decode Error","Source Not Supported":"Source Not Supported","Encryption Error":"Encryption Error","A network error caused the media download to fail.":"A network error caused the media download to fail.","A media error caused playback to be aborted. The media could be corrupt or your browser does not support this format.":"A media error caused playback to be aborted. The media could be corrupt or your browser does not support this format.","An unsupported error occurred. The server or network failed, or your browser does not support this format.":"An unsupported error occurred. The server or network failed, or your browser does not support this format.","The media is encrypted and there are no keys to decrypt it.":"The media is encrypted and there are no keys to decrypt it.",hour:"hour",hours:"hours",minute:"minute",minutes:"minutes",second:"second",seconds:"seconds","{time} remaining":"{time} remaining","{currentTime} of {totalTime}":"{currentTime} of {totalTime}","video not loaded, unknown time.":"video not loaded, unknown time."};var kr;const ai={en:$o};let Pt=((kr=globalThis.navigator)==null?void 0:kr.language)||"en";const Ho=t=>{Pt=t},Fo=t=>{var e,i,a;const[s]=Pt.split("-");return((e=ai[Pt])==null?void 0:e[t])||((i=ai[s])==null?void 0:i[t])||((a=ai.en)==null?void 0:a[t])||t},Wo=()=>{const[t]=Pt.split("-");return ai[Pt]?Pt:ai[t]?t:"en"},f=(t,e={})=>Fo(t).replace(/\{(\w+)\}/g,(i,a)=>a in e?String(e[a]):`{${a}}`),Mr=[{singular:"hour",plural:"hours"},{singular:"minute",plural:"minutes"},{singular:"second",plural:"seconds"}],Bo=(t,e)=>{const i=f(t===1?Mr[e].singular:Mr[e].plural);return`${t} ${i}`},si=t=>{if(!ks(t))return"";const e=Math.abs(t),i=e!==t,a=new Date(0,0,0,0,0,e,0),r=[a.getHours(),a.getMinutes(),a.getSeconds()].map((o,d)=>o&&Bo(o,d)).filter(o=>o).join(", ");return i?f("{time} remaining",{time:r}):r};function Xe(t,e){let i=!1;t<0&&(i=!0,t=0-t),t=t<0?0:t;let a=Math.floor(t%60),s=Math.floor(t/60%60),r=Math.floor(t/3600);const o=Math.floor(e/60%60),d=Math.floor(e/3600);return(isNaN(t)||t===1/0)&&(r=s=a="0"),r=r>0||d>0?r+":":"",s=((r||o>=10)&&s<10?"0"+s:s)+":",a=a<10?"0"+a:a,(i?"-":"")+r+s+a}class ln{addEventListener(){}removeEventListener(){}dispatchEvent(){return!0}}class dn extends ln{}class Lr extends dn{constructor(){super(...arguments),this.role=null}}class Vo{observe(){}unobserve(){}disconnect(){}}const cn={createElement:function(){return new li.HTMLElement},createElementNS:function(){return new li.HTMLElement},addEventListener(){},removeEventListener(){},dispatchEvent(t){return!1}},li={ResizeObserver:Vo,document:cn,Node:dn,Element:Lr,HTMLElement:class extends Lr{constructor(){super(...arguments),this.innerHTML=""}get content(){return new li.DocumentFragment}},DocumentFragment:class extends ln{},customElements:{get:function(){},define:function(){},whenDefined:function(){}},localStorage:{getItem(t){return null},setItem(t,e){},removeItem(t){}},CustomEvent:function(){},getComputedStyle:function(){},navigator:{languages:[],get userAgent(){return""}},matchMedia(t){return{matches:!1,media:t}},DOMParser:class{parseFromString(e,i){return{body:{textContent:e}}}}},un="global"in globalThis&&globalThis?.global===globalThis||typeof window>"u"||typeof window.customElements>"u",hn=Object.keys(li).every(t=>t in globalThis),l=un&&!hn?li:globalThis,re=un&&!hn?cn:globalThis.document,wr=new WeakMap,Ms=t=>{let e=wr.get(t);return e||wr.set(t,e=new Set),e},mn=new l.ResizeObserver(t=>{for(const e of t)for(const i of Ms(e.target))i(e)});function pn(t,e){Ms(t).add(e),mn.observe(t)}function En(t,e){const i=Ms(t);i.delete(e),i.size||mn.unobserve(t)}function Ae(t){const e={};for(const i of t)e[i.name]=i.value;return e}function Ko(t){var e;return(e=Go(t))!=null?e:Ei(t,"media-controller")}function Go(t){var e;const{MEDIA_CONTROLLER:i}=P,a=t.getAttribute(i);if(a)return(e=Yo(t))==null?void 0:e.getElementById(a)}const vn=(t,e,i=".value")=>{const a=t.querySelector(i);a&&(a.textContent=e)},qo=(t,e)=>{const i=`slot[name="${e}"]`,a=t.shadowRoot.querySelector(i);return a?a.children:[]},fn=(t,e)=>qo(t,e)[0],Nt=(t,e)=>!t||!e?!1:t?.contains(e)?!0:Nt(t,e.getRootNode().host),Ei=(t,e)=>{if(!t)return null;const i=t.closest(e);return i||Ei(t.getRootNode().host,e)};function _n(t=document){var e;const i=t?.activeElement;return i?(e=_n(i.shadowRoot))!=null?e:i:null}function Yo(t){var e;const i=(e=t?.getRootNode)==null?void 0:e.call(t);return i instanceof ShadowRoot||i instanceof Document?i:null}function gn(t,{depth:e=3,checkOpacity:i=!0,checkVisibilityCSS:a=!0}={}){if(t.checkVisibility)return t.checkVisibility({checkOpacity:i,checkVisibilityCSS:a});let s=t;for(;s&&e>0;){const r=getComputedStyle(s);if(i&&r.opacity==="0"||a&&r.visibility==="hidden"||r.display==="none")return!1;s=s.parentElement,e--}return!0}function Qo(t,e,i,a){const s=a.x-i.x,r=a.y-i.y,o=s*s+r*r;if(o===0)return 0;const d=((t-i.x)*s+(e-i.y)*r)/o;return Math.max(0,Math.min(1,d))}function Q(t,e){const i=zo(t,a=>a===e);return i||bn(t,e)}function zo(t,e){var i,a;let s;for(s of(i=t.querySelectorAll("style:not([media])"))!=null?i:[]){let r;try{r=(a=s.sheet)==null?void 0:a.cssRules}catch{continue}for(const o of r??[])if(e(o.selectorText))return o}}function bn(t,e){var i,a;const s=(i=t.querySelectorAll("style:not([media])"))!=null?i:[],r=s?.[s.length-1];if(!r?.sheet)return console.warn("Media Chrome: No style sheet found on style tag of",t),{style:{setProperty:()=>{},removeProperty:()=>"",getPropertyValue:()=>""}};const o=r?.sheet.insertRule(`${e}{}`,r.sheet.cssRules.length);return(a=r.sheet.cssRules)==null?void 0:a[o]}function H(t,e,i=Number.NaN){const a=t.getAttribute(e);return a!=null?+a:i}function j(t,e,i){const a=+i;if(i==null||Number.isNaN(a)){t.hasAttribute(e)&&t.removeAttribute(e);return}H(t,e,void 0)!==a&&t.setAttribute(e,`${a}`)}function M(t,e){return t.hasAttribute(e)}function L(t,e,i){if(i==null){t.hasAttribute(e)&&t.removeAttribute(e);return}M(t,e)!=i&&t.toggleAttribute(e,i)}function B(t,e,i=null){var a;return(a=t.getAttribute(e))!=null?a:i}function F(t,e,i){if(i==null){t.hasAttribute(e)&&t.removeAttribute(e);return}const a=`${i}`;B(t,e,void 0)!==a&&t.setAttribute(e,a)}var An=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},pe=(t,e,i)=>(An(t,e,"read from private field"),i?i.call(t):e.get(t)),Zo=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},gi=(t,e,i,a)=>(An(t,e,"write to private field"),e.set(t,i),i),ie;function Xo(t){return`
    <style>
      :host {
        display: var(--media-control-display, var(--media-gesture-receiver-display, inline-block));
        box-sizing: border-box;
      }
    </style>
  `}class ga extends l.HTMLElement{constructor(){if(super(),Zo(this,ie,void 0),!this.shadowRoot){this.attachShadow(this.constructor.shadowRootOptions);const e=Ae(this.attributes);this.shadowRoot.innerHTML=this.constructor.getTemplateHTML(e)}}static get observedAttributes(){return[P.MEDIA_CONTROLLER,n.MEDIA_PAUSED]}attributeChangedCallback(e,i,a){var s,r,o,d,c;e===P.MEDIA_CONTROLLER&&(i&&((r=(s=pe(this,ie))==null?void 0:s.unassociateElement)==null||r.call(s,this),gi(this,ie,null)),a&&this.isConnected&&(gi(this,ie,(o=this.getRootNode())==null?void 0:o.getElementById(a)),(c=(d=pe(this,ie))==null?void 0:d.associateElement)==null||c.call(d,this)))}connectedCallback(){var e,i;this.tabIndex=-1,this.setAttribute("aria-hidden","true"),gi(this,ie,Jo(this)),this.getAttribute(P.MEDIA_CONTROLLER)&&((i=(e=pe(this,ie))==null?void 0:e.associateElement)==null||i.call(e,this)),pe(this,ie)&&(pe(this,ie).addEventListener("pointerdown",this),pe(this,ie).addEventListener("click",this),pe(this,ie).hasAttribute("tabindex")||(pe(this,ie).tabIndex=0))}disconnectedCallback(){var e,i,a,s;this.getAttribute(P.MEDIA_CONTROLLER)&&((i=(e=pe(this,ie))==null?void 0:e.unassociateElement)==null||i.call(e,this)),(a=pe(this,ie))==null||a.removeEventListener("pointerdown",this),(s=pe(this,ie))==null||s.removeEventListener("click",this),gi(this,ie,null)}handleEvent(e){var i;const a=(i=e.composedPath())==null?void 0:i[0];if(["video","media-controller"].includes(a?.localName)){if(e.type==="pointerdown")this._pointerType=e.pointerType;else if(e.type==="click"){const{clientX:r,clientY:o}=e,{left:d,top:c,width:y,height:I}=this.getBoundingClientRect(),g=r-d,E=o-c;if(g<0||E<0||g>y||E>I||y===0&&I===0)return;const m=this._pointerType||"mouse";if(this._pointerType=void 0,m===Ga.TOUCH){this.handleTap(e);return}else if(m===Ga.MOUSE||m===Ga.PEN){this.handleMouseClick(e);return}}}}get mediaPaused(){return M(this,n.MEDIA_PAUSED)}set mediaPaused(e){L(this,n.MEDIA_PAUSED,e)}handleTap(e){}handleMouseClick(e){const i=this.mediaPaused?p.MEDIA_PLAY_REQUEST:p.MEDIA_PAUSE_REQUEST;this.dispatchEvent(new l.CustomEvent(i,{composed:!0,bubbles:!0}))}}ie=new WeakMap;ga.shadowRootOptions={mode:"open"};ga.getTemplateHTML=Xo;function Jo(t){var e;const i=t.getAttribute(P.MEDIA_CONTROLLER);return i?(e=t.getRootNode())==null?void 0:e.getElementById(i):Ei(t,"media-controller")}l.customElements.get("media-gesture-receiver")||l.customElements.define("media-gesture-receiver",ga);var za=ga,Ls=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},W=(t,e,i)=>(Ls(t,e,"read from private field"),i?i.call(t):e.get(t)),se=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},Ee=(t,e,i,a)=>(Ls(t,e,"write to private field"),e.set(t,i),i),be=(t,e,i)=>(Ls(t,e,"access private method"),i),Kt,ra,vt,xt,Rt,Za,ft,Di,Xa,Tn,Ja,In,di,ba,Aa,ws,Ut,ci,Ve,Ci;const b={AUDIO:"audio",AUTOHIDE:"autohide",BREAKPOINTS:"breakpoints",GESTURES_DISABLED:"gesturesdisabled",KEYBOARD_CONTROL:"keyboardcontrol",NO_AUTOHIDE:"noautohide",USER_INACTIVE:"userinactive",AUTOHIDE_OVER_CONTROLS:"autohideovercontrols"};function jo(t){return`
    <style>
      
      :host([${n.MEDIA_IS_FULLSCREEN}]) ::slotted([slot=media]) {
        outline: none;
      }

      :host {
        box-sizing: border-box;
        position: relative;
        display: inline-block;
        line-height: 0;
        background-color: var(--media-background-color, #000);
        overflow: hidden;
      }

      :host(:not([${b.AUDIO}])) [part~=layer]:not([part~=media-layer]) {
        position: absolute;
        top: 0;
        left: 0;
        bottom: 0;
        right: 0;
        display: flex;
        flex-flow: column nowrap;
        align-items: start;
        pointer-events: none;
        background: none;
      }

      slot[name=media] {
        display: var(--media-slot-display, contents);
      }

      
      :host([${b.AUDIO}]) slot[name=media] {
        display: var(--media-slot-display, none);
      }

      
      :host([${b.AUDIO}]) [part~=layer][part~=gesture-layer] {
        height: 0;
        display: block;
      }

      
      :host(:not([${b.AUDIO}])[${b.GESTURES_DISABLED}]) ::slotted([slot=gestures-chrome]),
          :host(:not([${b.AUDIO}])[${b.GESTURES_DISABLED}]) media-gesture-receiver[slot=gestures-chrome] {
        display: none;
      }

      
      ::slotted(:not([slot=media]):not([slot=poster]):not(media-loading-indicator):not([role=dialog]):not([hidden])) {
        pointer-events: auto;
      }

      :host(:not([${b.AUDIO}])) *[part~=layer][part~=centered-layer] {
        align-items: center;
        justify-content: center;
      }

      :host(:not([${b.AUDIO}])) ::slotted(media-gesture-receiver[slot=gestures-chrome]),
      :host(:not([${b.AUDIO}])) media-gesture-receiver[slot=gestures-chrome] {
        align-self: stretch;
        flex-grow: 1;
      }

      slot[name=middle-chrome] {
        display: inline;
        flex-grow: 1;
        pointer-events: none;
        background: none;
      }

      
      ::slotted([slot=media]),
      ::slotted([slot=poster]) {
        width: 100%;
        height: 100%;
      }

      
      :host(:not([${b.AUDIO}])) .spacer {
        flex-grow: 1;
      }

      
      :host(:-webkit-full-screen) {
        
        width: 100% !important;
        height: 100% !important;
      }

      
      ::slotted(:not([slot=media]):not([slot=poster]):not([${b.NO_AUTOHIDE}]):not([hidden]):not([role=dialog])) {
        opacity: 1;
        transition: var(--media-control-transition-in, opacity 0.25s);
      }

      
      :host([${b.USER_INACTIVE}]:not([${n.MEDIA_PAUSED}]):not([${n.MEDIA_IS_AIRPLAYING}]):not([${n.MEDIA_IS_CASTING}]):not([${b.AUDIO}])) ::slotted(:not([slot=media]):not([slot=poster]):not([${b.NO_AUTOHIDE}]):not([role=dialog])) {
        opacity: 0;
        transition: var(--media-control-transition-out, opacity 1s);
      }

      :host([${b.USER_INACTIVE}]:not([${b.NO_AUTOHIDE}]):not([${n.MEDIA_PAUSED}]):not([${n.MEDIA_IS_CASTING}]):not([${b.AUDIO}])) ::slotted([slot=media]) {
        cursor: none;
      }

      :host([${b.USER_INACTIVE}][${b.AUTOHIDE_OVER_CONTROLS}]:not([${b.NO_AUTOHIDE}]):not([${n.MEDIA_PAUSED}]):not([${n.MEDIA_IS_CASTING}]):not([${b.AUDIO}])) * {
        --media-cursor: none;
        cursor: none;
      }


      ::slotted(media-control-bar)  {
        align-self: stretch;
      }

      
      :host(:not([${b.AUDIO}])[${n.MEDIA_HAS_PLAYED}]) slot[name=poster] {
        display: none;
      }

      ::slotted([role=dialog]) {
        width: 100%;
        height: 100%;
        align-self: center;
      }

      ::slotted([role=menu]) {
        align-self: end;
      }
    </style>

    <slot name="media" part="layer media-layer"></slot>
    <slot name="poster" part="layer poster-layer"></slot>
    <slot name="gestures-chrome" part="layer gesture-layer">
      <media-gesture-receiver slot="gestures-chrome">
        <template shadowrootmode="${za.shadowRootOptions.mode}">
          ${za.getTemplateHTML({})}
        </template>
      </media-gesture-receiver>
    </slot>
    <span part="layer vertical-layer">
      <slot name="top-chrome" part="top chrome"></slot>
      <slot name="middle-chrome" part="middle chrome"></slot>
      <slot name="centered-chrome" part="layer centered-layer center centered chrome"></slot>
      
      <slot part="bottom chrome"></slot>
    </span>
    <slot name="dialog" part="layer dialog-layer"></slot>
  `}const el=Object.values(n),tl="sm:384 md:576 lg:768 xl:960";function il(t){yn(t.target,t.contentRect.width)}function yn(t,e){var i;if(!t.isConnected)return;const a=(i=t.getAttribute(b.BREAKPOINTS))!=null?i:tl,s=al(a),r=sl(s,e);let o=!1;if(Object.keys(s).forEach(d=>{if(r.includes(d)){t.hasAttribute(`breakpoint${d}`)||(t.setAttribute(`breakpoint${d}`,""),o=!0);return}t.hasAttribute(`breakpoint${d}`)&&(t.removeAttribute(`breakpoint${d}`),o=!0)}),o){const d=new CustomEvent(Ot.BREAKPOINTS_CHANGE,{detail:r});t.dispatchEvent(d)}t.breakpointsComputed||(t.breakpointsComputed=!0,t.dispatchEvent(new CustomEvent(Ot.BREAKPOINTS_COMPUTED,{bubbles:!0,composed:!0})))}function al(t){const e=t.split(/\s+/);return Object.fromEntries(e.map(i=>i.split(":")))}function sl(t,e){return Object.keys(t).filter(i=>e>=parseInt(t[i]))}class vi extends l.HTMLElement{constructor(){if(super(),se(this,Xa),se(this,Ja),se(this,di),se(this,Aa),se(this,Ut),se(this,Kt,void 0),se(this,ra,0),se(this,vt,null),se(this,xt,null),se(this,Rt,void 0),this.breakpointsComputed=!1,se(this,Za,e=>{const i=this.media;for(const a of e){if(a.type!=="childList")continue;const s=a.removedNodes;for(const r of s){if(r.slot!="media"||a.target!=this)continue;let o=a.previousSibling&&a.previousSibling.previousElementSibling;if(!o||!i)this.mediaUnsetCallback(r);else{let d=o.slot!=="media";for(;(o=o.previousSibling)!==null;)o.slot=="media"&&(d=!1);d&&this.mediaUnsetCallback(r)}}if(i)for(const r of a.addedNodes)r===i&&this.handleMediaUpdated(i)}}),se(this,ft,!1),se(this,Di,e=>{W(this,ft)||(setTimeout(()=>{il(e),Ee(this,ft,!1)},0),Ee(this,ft,!0))}),se(this,Ve,void 0),se(this,Ci,()=>{if(!W(this,Ve).assignedElements({flatten:!0}).length){W(this,vt)&&this.mediaUnsetCallback(W(this,vt));return}this.handleMediaUpdated(this.media)}),!this.shadowRoot){this.attachShadow(this.constructor.shadowRootOptions);const e=Ae(this.attributes),i=this.constructor.getTemplateHTML(e);this.shadowRoot.setHTMLUnsafe?this.shadowRoot.setHTMLUnsafe(i):this.shadowRoot.innerHTML=i}Ee(this,Kt,new MutationObserver(W(this,Za)))}static get observedAttributes(){return[b.AUTOHIDE,b.GESTURES_DISABLED].concat(el).filter(e=>![n.MEDIA_RENDITION_LIST,n.MEDIA_AUDIO_TRACK_LIST,n.MEDIA_CHAPTERS_CUES,n.MEDIA_WIDTH,n.MEDIA_HEIGHT,n.MEDIA_ERROR,n.MEDIA_ERROR_MESSAGE].includes(e))}attributeChangedCallback(e,i,a){e.toLowerCase()==b.AUTOHIDE&&(this.autohide=a)}get media(){let e=this.querySelector(":scope > [slot=media]");return e?.nodeName=="SLOT"&&(e=e.assignedElements({flatten:!0})[0]),e}async handleMediaUpdated(e){e&&(Ee(this,vt,e),e.localName.includes("-")&&await l.customElements.whenDefined(e.localName),this.mediaSetCallback(e))}connectedCallback(){var e;W(this,Kt).observe(this,{childList:!0,subtree:!0}),pn(this,W(this,Di));const i=this.getAttribute(b.AUDIO)!=null,a=f(i?"audio player":"video player");this.setAttribute("role","region"),this.setAttribute("aria-label",a),this.handleMediaUpdated(this.media),this.setAttribute(b.USER_INACTIVE,""),yn(this,this.getBoundingClientRect().width);const s=this.querySelector(":scope > slot[slot=media]");s&&(Ee(this,Ve,s),W(this,Ve).addEventListener("slotchange",W(this,Ci))),this.addEventListener("pointerdown",this),this.addEventListener("pointermove",this),this.addEventListener("pointerup",this),this.addEventListener("mouseleave",this),this.addEventListener("keyup",this),(e=l.window)==null||e.addEventListener("mouseup",this)}disconnectedCallback(){var e;En(this,W(this,Di)),clearTimeout(W(this,xt)),W(this,Kt).disconnect(),this.media&&this.mediaUnsetCallback(this.media),(e=l.window)==null||e.removeEventListener("mouseup",this),this.removeEventListener("pointerdown",this),this.removeEventListener("pointermove",this),this.removeEventListener("pointerup",this),this.removeEventListener("mouseleave",this),this.removeEventListener("keyup",this),W(this,Ve)&&(W(this,Ve).removeEventListener("slotchange",W(this,Ci)),Ee(this,Ve,null)),Ee(this,ft,!1)}mediaSetCallback(e){}mediaUnsetCallback(e){Ee(this,vt,null)}handleEvent(e){switch(e.type){case"pointerdown":Ee(this,ra,e.timeStamp);break;case"pointermove":be(this,Xa,Tn).call(this,e);break;case"pointerup":be(this,Ja,In).call(this,e);break;case"mouseleave":be(this,di,ba).call(this);break;case"mouseup":this.removeAttribute(b.KEYBOARD_CONTROL);break;case"keyup":be(this,Ut,ci).call(this),this.setAttribute(b.KEYBOARD_CONTROL,"");break}}set autohide(e){const i=Number(e);Ee(this,Rt,isNaN(i)?0:i)}get autohide(){return(W(this,Rt)===void 0?2:W(this,Rt)).toString()}get breakpoints(){return B(this,b.BREAKPOINTS)}set breakpoints(e){F(this,b.BREAKPOINTS,e)}get audio(){return M(this,b.AUDIO)}set audio(e){L(this,b.AUDIO,e)}get gesturesDisabled(){return M(this,b.GESTURES_DISABLED)}set gesturesDisabled(e){L(this,b.GESTURES_DISABLED,e)}get keyboardControl(){return M(this,b.KEYBOARD_CONTROL)}set keyboardControl(e){L(this,b.KEYBOARD_CONTROL,e)}get noAutohide(){return M(this,b.NO_AUTOHIDE)}set noAutohide(e){L(this,b.NO_AUTOHIDE,e)}get autohideOverControls(){return M(this,b.AUTOHIDE_OVER_CONTROLS)}set autohideOverControls(e){L(this,b.AUTOHIDE_OVER_CONTROLS,e)}get userInteractive(){return M(this,b.USER_INACTIVE)}set userInteractive(e){L(this,b.USER_INACTIVE,e)}}Kt=new WeakMap;ra=new WeakMap;vt=new WeakMap;xt=new WeakMap;Rt=new WeakMap;Za=new WeakMap;ft=new WeakMap;Di=new WeakMap;Xa=new WeakSet;Tn=function(t){if(t.pointerType!=="mouse"&&t.timeStamp-W(this,ra)<250)return;be(this,Aa,ws).call(this),clearTimeout(W(this,xt));const e=this.hasAttribute(b.AUTOHIDE_OVER_CONTROLS);([this,this.media].includes(t.target)||e)&&be(this,Ut,ci).call(this)};Ja=new WeakSet;In=function(t){if(t.pointerType==="touch"){const e=!this.hasAttribute(b.USER_INACTIVE);[this,this.media].includes(t.target)&&e?be(this,di,ba).call(this):be(this,Ut,ci).call(this)}else t.composedPath().some(e=>["media-play-button","media-fullscreen-button"].includes(e?.localName))&&be(this,Ut,ci).call(this)};di=new WeakSet;ba=function(){if(W(this,Rt)<0||this.hasAttribute(b.USER_INACTIVE))return;this.setAttribute(b.USER_INACTIVE,"");const t=new l.CustomEvent(Ot.USER_INACTIVE_CHANGE,{composed:!0,bubbles:!0,detail:!0});this.dispatchEvent(t)};Aa=new WeakSet;ws=function(){if(!this.hasAttribute(b.USER_INACTIVE))return;this.removeAttribute(b.USER_INACTIVE);const t=new l.CustomEvent(Ot.USER_INACTIVE_CHANGE,{composed:!0,bubbles:!0,detail:!1});this.dispatchEvent(t)};Ut=new WeakSet;ci=function(){be(this,Aa,ws).call(this),clearTimeout(W(this,xt));const t=parseInt(this.autohide);t<0||Ee(this,xt,setTimeout(()=>{be(this,di,ba).call(this)},t*1e3))};Ve=new WeakMap;Ci=new WeakMap;vi.shadowRootOptions={mode:"open"};vi.getTemplateHTML=jo;l.customElements.get("media-container")||l.customElements.define("media-container",vi);var rl=vi,Sn=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},J=(t,e,i)=>(Sn(t,e,"read from private field"),i?i.call(t):e.get(t)),Ht=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},bi=(t,e,i,a)=>(Sn(t,e,"write to private field"),e.set(t,i),i),_t,gt,na,it,Ue,Ke;class kn{constructor(e,i,{defaultValue:a}={defaultValue:void 0}){Ht(this,Ue),Ht(this,_t,void 0),Ht(this,gt,void 0),Ht(this,na,void 0),Ht(this,it,new Set),bi(this,_t,e),bi(this,gt,i),bi(this,na,new Set(a))}[Symbol.iterator](){return J(this,Ue,Ke).values()}get length(){return J(this,Ue,Ke).size}get value(){var e;return(e=[...J(this,Ue,Ke)].join(" "))!=null?e:""}set value(e){var i;e!==this.value&&(bi(this,it,new Set),this.add(...(i=e?.split(" "))!=null?i:[]))}toString(){return this.value}item(e){return[...J(this,Ue,Ke)][e]}values(){return J(this,Ue,Ke).values()}forEach(e,i){J(this,Ue,Ke).forEach(e,i)}add(...e){var i,a;e.forEach(s=>J(this,it).add(s)),!(this.value===""&&!((i=J(this,_t))!=null&&i.hasAttribute(`${J(this,gt)}`)))&&((a=J(this,_t))==null||a.setAttribute(`${J(this,gt)}`,`${this.value}`))}remove(...e){var i;e.forEach(a=>J(this,it).delete(a)),(i=J(this,_t))==null||i.setAttribute(`${J(this,gt)}`,`${this.value}`)}contains(e){return J(this,Ue,Ke).has(e)}toggle(e,i){return typeof i<"u"?i?(this.add(e),!0):(this.remove(e),!1):this.contains(e)?(this.remove(e),!1):(this.add(e),!0)}replace(e,i){return this.remove(e),this.add(i),e===i}}_t=new WeakMap;gt=new WeakMap;na=new WeakMap;it=new WeakMap;Ue=new WeakSet;Ke=function(){return J(this,it).size?J(this,it):J(this,na)};const nl=(t="")=>t.split(/\s+/),Mn=(t="")=>{const[e,i,a]=t.split(":"),s=a?decodeURIComponent(a):void 0;return{kind:e==="cc"?Ce.CAPTIONS:Ce.SUBTITLES,language:i,label:s}},Ln=(t="",e={})=>nl(t).map(i=>{const a=Mn(i);return{...e,...a}}),wn=t=>t?Array.isArray(t)?t.map(e=>typeof e=="string"?Mn(e):e):typeof t=="string"?Ln(t):[t]:[],ol=({kind:t,label:e,language:i}={kind:"subtitles"})=>e?`${t==="captions"?"cc":"sb"}:${i}:${encodeURIComponent(e)}`:i,ja=(t=[])=>Array.prototype.map.call(t,ol).join(" "),ll=(t,e)=>i=>i[t]===e,Rn=t=>{const e=Object.entries(t).map(([i,a])=>ll(i,a));return i=>e.every(a=>a(i))},ri=(t,e=[],i=[])=>{const a=wn(i).map(Rn),s=r=>a.some(o=>o(r));Array.from(e).filter(s).forEach(r=>{r.mode=t})},Ta=(t,e=()=>!0)=>{if(!t?.textTracks)return[];const i=typeof e=="function"?e:Rn(e);return Array.from(t.textTracks).filter(i)},dl=t=>{var e;return!!((e=t.mediaSubtitlesShowing)!=null&&e.length)||t.hasAttribute(n.MEDIA_SUBTITLES_SHOWING)},cl=t=>{var e;const{media:i,fullscreenElement:a}=t;try{const s=a&&"requestFullscreen"in a?"requestFullscreen":a&&"webkitRequestFullScreen"in a?"webkitRequestFullScreen":void 0;if(s){const r=(e=a[s])==null?void 0:e.call(a);if(r instanceof Promise)return r.catch(()=>{})}else i?.webkitEnterFullscreen?i.webkitEnterFullscreen():i?.requestFullscreen&&i.requestFullscreen()}catch(s){console.error(s)}},Rr="exitFullscreen"in re?"exitFullscreen":"webkitExitFullscreen"in re?"webkitExitFullscreen":"webkitCancelFullScreen"in re?"webkitCancelFullScreen":void 0,ul=t=>{var e;const{documentElement:i}=t;if(Rr){const a=(e=i?.[Rr])==null?void 0:e.call(i);if(a instanceof Promise)return a.catch(()=>{})}},Gt="fullscreenElement"in re?"fullscreenElement":"webkitFullscreenElement"in re?"webkitFullscreenElement":void 0,hl=t=>{const{documentElement:e,media:i}=t,a=e?.[Gt];return!a&&"webkitDisplayingFullscreen"in i&&"webkitPresentationMode"in i&&i.webkitDisplayingFullscreen&&i.webkitPresentationMode===Po.FULLSCREEN?i:a},ml=t=>{var e;const{media:i,documentElement:a,fullscreenElement:s=i}=t;if(!i||!a)return!1;const r=hl(t);if(!r)return!1;if(r===s||r===i)return!0;if(r.localName.includes("-")){let o=r.shadowRoot;if(!(Gt in o))return Nt(r,s);for(;o?.[Gt];){if(o[Gt]===s)return!0;o=(e=o[Gt])==null?void 0:e.shadowRoot}}return!1},pl="fullscreenEnabled"in re?"fullscreenEnabled":"webkitFullscreenEnabled"in re?"webkitFullscreenEnabled":void 0,El=t=>{const{documentElement:e,media:i}=t;return!!e?.[pl]||i&&"webkitSupportsFullscreen"in i};let Ai;const Rs=()=>{var t,e;return Ai||(Ai=(e=(t=re)==null?void 0:t.createElement)==null?void 0:e.call(t,"video"),Ai)},vl=async(t=Rs())=>{if(!t)return!1;const e=t.volume;t.volume=e/2+.1;const i=new AbortController,a=await Promise.race([fl(t,i.signal),_l(t,e)]);return i.abort(),a},fl=(t,e)=>new Promise(i=>{t.addEventListener("volumechange",()=>i(!0),{signal:e})}),_l=async(t,e)=>{for(let i=0;i<10;i++){if(t.volume===e)return!1;await on(10)}return t.volume!==e},gl=/.*Version\/.*Safari\/.*/.test(l.navigator.userAgent),Dn=(t=Rs())=>l.matchMedia("(display-mode: standalone)").matches&&gl?!1:typeof t?.requestPictureInPicture=="function",Cn=(t=Rs())=>El({documentElement:re,media:t}),bl=Cn(),Al=Dn(),Tl=!!l.WebKitPlaybackTargetAvailabilityEvent,Il=!!l.chrome,oa=t=>Ta(t.media,e=>[Ce.SUBTITLES,Ce.CAPTIONS].includes(e.kind)).sort((e,i)=>e.kind>=i.kind?1:-1),Pn=t=>Ta(t.media,e=>e.mode===Ct.SHOWING&&[Ce.SUBTITLES,Ce.CAPTIONS].includes(e.kind)),On=(t,e)=>{const i=oa(t),a=Pn(t),s=!!a.length;if(i.length){if(e===!1||s&&e!==!0)ri(Ct.DISABLED,i,a);else if(e===!0||!s&&e!==!1){let r=i[0];const{options:o}=t;if(!o?.noSubtitlesLangPref){const I=l.localStorage.getItem("media-chrome-pref-subtitles-lang"),g=I?[I,...l.navigator.languages]:l.navigator.languages,E=i.filter(m=>g.some(h=>m.language.toLowerCase().startsWith(h.split("-")[0]))).sort((m,h)=>{const v=g.findIndex(T=>m.language.toLowerCase().startsWith(T.split("-")[0])),A=g.findIndex(T=>h.language.toLowerCase().startsWith(T.split("-")[0]));return v-A});E[0]&&(r=E[0])}const{language:d,label:c,kind:y}=r;ri(Ct.DISABLED,i,a),ri(Ct.SHOWING,i,[{language:d,label:c,kind:y}])}}},Ds=(t,e)=>t===e?!0:t==null||e==null||typeof t!=typeof e?!1:typeof t=="number"&&Number.isNaN(t)&&Number.isNaN(e)?!0:typeof t!="object"?!1:Array.isArray(t)?yl(t,e):Object.entries(t).every(([i,a])=>i in e&&Ds(a,e[i])),yl=(t,e)=>{const i=Array.isArray(t),a=Array.isArray(e);return i!==a?!1:i||a?t.length!==e.length?!1:t.every((s,r)=>Ds(s,e[r])):!0},Sl=Object.values(Ne);let la;const kl=vl().then(t=>(la=t,la)),Ml=async(...t)=>{await Promise.all(t.filter(e=>e).map(async e=>{if(!("localName"in e&&e instanceof l.HTMLElement))return;const i=e.localName;if(!i.includes("-"))return;const a=l.customElements.get(i);a&&e instanceof a||(await l.customElements.whenDefined(i),l.customElements.upgrade(e))}))},Ll=new l.DOMParser,wl=t=>t&&(Ll.parseFromString(t,"text/html").body.textContent||t),qt={mediaError:{get(t,e){const{media:i}=t;if(e?.type!=="playing")return i?.error},mediaEvents:["emptied","error","playing"]},mediaErrorCode:{get(t,e){var i;const{media:a}=t;if(e?.type!=="playing")return(i=a?.error)==null?void 0:i.code},mediaEvents:["emptied","error","playing"]},mediaErrorMessage:{get(t,e){var i,a;const{media:s}=t;if(e?.type!=="playing")return(a=(i=s?.error)==null?void 0:i.message)!=null?a:""},mediaEvents:["emptied","error","playing"]},mediaWidth:{get(t){var e;const{media:i}=t;return(e=i?.videoWidth)!=null?e:0},mediaEvents:["resize"]},mediaHeight:{get(t){var e;const{media:i}=t;return(e=i?.videoHeight)!=null?e:0},mediaEvents:["resize"]},mediaPaused:{get(t){var e;const{media:i}=t;return(e=i?.paused)!=null?e:!0},set(t,e){var i;const{media:a}=e;a&&(t?a.pause():(i=a.play())==null||i.catch(()=>{}))},mediaEvents:["play","playing","pause","emptied"]},mediaHasPlayed:{get(t,e){const{media:i}=t;return i?e?e.type==="playing":!i.paused:!1},mediaEvents:["playing","emptied"]},mediaEnded:{get(t){var e;const{media:i}=t;return(e=i?.ended)!=null?e:!1},mediaEvents:["seeked","ended","emptied"]},mediaPlaybackRate:{get(t){var e;const{media:i}=t;return(e=i?.playbackRate)!=null?e:1},set(t,e){const{media:i}=e;i&&Number.isFinite(+t)&&(i.playbackRate=+t)},mediaEvents:["ratechange","loadstart"]},mediaMuted:{get(t){var e;const{media:i}=t;return(e=i?.muted)!=null?e:!1},set(t,e){const{media:i,options:{noMutedPref:a}={}}=e;if(i){i.muted=t;try{const s=l.localStorage.getItem("media-chrome-pref-muted")!==null,r=i.hasAttribute("muted");if(a){s&&l.localStorage.removeItem("media-chrome-pref-muted");return}if(r&&!s)return;l.localStorage.setItem("media-chrome-pref-muted",t?"true":"false")}catch(s){console.debug("Error setting muted pref",s)}}},mediaEvents:["volumechange"],stateOwnersUpdateHandlers:[(t,e)=>{const{options:{noMutedPref:i}}=e,{media:a}=e;if(!(!a||a.muted||i))try{const s=l.localStorage.getItem("media-chrome-pref-muted")==="true";qt.mediaMuted.set(s,e),t(s)}catch(s){console.debug("Error getting muted pref",s)}}]},mediaLoop:{get(t){const{media:e}=t;return e?.loop},set(t,e){const{media:i}=e;i&&(i.loop=t)},mediaEvents:["medialooprequest"]},mediaVolume:{get(t){var e;const{media:i}=t;return(e=i?.volume)!=null?e:1},set(t,e){const{media:i,options:{noVolumePref:a}={}}=e;if(i){try{t==null?l.localStorage.removeItem("media-chrome-pref-volume"):!i.hasAttribute("muted")&&!a&&l.localStorage.setItem("media-chrome-pref-volume",t.toString())}catch(s){console.debug("Error setting volume pref",s)}Number.isFinite(+t)&&(i.volume=+t)}},mediaEvents:["volumechange"],stateOwnersUpdateHandlers:[(t,e)=>{const{options:{noVolumePref:i}}=e;if(!i)try{const{media:a}=e;if(!a)return;const s=l.localStorage.getItem("media-chrome-pref-volume");if(s==null)return;qt.mediaVolume.set(+s,e),t(+s)}catch(a){console.debug("Error getting volume pref",a)}}]},mediaVolumeLevel:{get(t){const{media:e}=t;return typeof e?.volume>"u"?"high":e.muted||e.volume===0?"off":e.volume<.5?"low":e.volume<.75?"medium":"high"},mediaEvents:["volumechange"]},mediaCurrentTime:{get(t){var e;const{media:i}=t;return(e=i?.currentTime)!=null?e:0},set(t,e){const{media:i}=e;!i||!ks(t)||(i.currentTime=t)},mediaEvents:["timeupdate","loadedmetadata"]},mediaDuration:{get(t){const{media:e,options:{defaultDuration:i}={}}=t;return i&&(!e||!e.duration||Number.isNaN(e.duration)||!Number.isFinite(e.duration))?i:Number.isFinite(e?.duration)?e.duration:Number.NaN},mediaEvents:["durationchange","loadedmetadata","emptied"]},mediaLoading:{get(t){const{media:e}=t;return e?.readyState<3},mediaEvents:["waiting","playing","emptied"]},mediaSeekable:{get(t){var e;const{media:i}=t;if(!((e=i?.seekable)!=null&&e.length))return;const a=i.seekable.start(0),s=i.seekable.end(i.seekable.length-1);if(!(!a&&!s))return[Number(a.toFixed(3)),Number(s.toFixed(3))]},mediaEvents:["loadedmetadata","emptied","progress","seekablechange"]},mediaBuffered:{get(t){var e;const{media:i}=t,a=(e=i?.buffered)!=null?e:[];return Array.from(a).map((s,r)=>[Number(a.start(r).toFixed(3)),Number(a.end(r).toFixed(3))])},mediaEvents:["progress","emptied"]},mediaStreamType:{get(t){const{media:e,options:{defaultStreamType:i}={}}=t,a=[Ne.LIVE,Ne.ON_DEMAND].includes(i)?i:void 0;if(!e)return a;const{streamType:s}=e;if(Sl.includes(s))return s===Ne.UNKNOWN?a:s;const r=e.duration;return r===1/0?Ne.LIVE:Number.isFinite(r)?Ne.ON_DEMAND:a},mediaEvents:["emptied","durationchange","loadedmetadata","streamtypechange"]},mediaTargetLiveWindow:{get(t){const{media:e}=t;if(!e)return Number.NaN;const{targetLiveWindow:i}=e,a=qt.mediaStreamType.get(t);return(i==null||Number.isNaN(i))&&a===Ne.LIVE?0:i},mediaEvents:["emptied","durationchange","loadedmetadata","streamtypechange","targetlivewindowchange"]},mediaTimeIsLive:{get(t){const{media:e,options:{liveEdgeOffset:i=10}={}}=t;if(!e)return!1;if(typeof e.liveEdgeStart=="number")return Number.isNaN(e.liveEdgeStart)?!1:e.currentTime>=e.liveEdgeStart;if(!(qt.mediaStreamType.get(t)===Ne.LIVE))return!1;const s=e.seekable;if(!s)return!0;if(!s.length)return!1;const r=s.end(s.length-1)-i;return e.currentTime>=r},mediaEvents:["playing","timeupdate","progress","waiting","emptied"]},mediaSubtitlesList:{get(t){return oa(t).map(({kind:e,label:i,language:a})=>({kind:e,label:i,language:a}))},mediaEvents:["loadstart"],textTracksEvents:["addtrack","removetrack"]},mediaSubtitlesShowing:{get(t){return Pn(t).map(({kind:e,label:i,language:a})=>({kind:e,label:i,language:a}))},mediaEvents:["loadstart"],textTracksEvents:["addtrack","removetrack","change"],stateOwnersUpdateHandlers:[(t,e)=>{var i,a;const{media:s,options:r}=e;if(!s)return;const o=d=>{var c;!r.defaultSubtitles||d&&![Ce.CAPTIONS,Ce.SUBTITLES].includes((c=d?.track)==null?void 0:c.kind)||On(e,!0)};return s.addEventListener("loadstart",o),(i=s.textTracks)==null||i.addEventListener("addtrack",o),(a=s.textTracks)==null||a.addEventListener("removetrack",o),()=>{var d,c;s.removeEventListener("loadstart",o),(d=s.textTracks)==null||d.removeEventListener("addtrack",o),(c=s.textTracks)==null||c.removeEventListener("removetrack",o)}}]},mediaChaptersCues:{get(t){var e;const{media:i}=t;if(!i)return[];const[a]=Ta(i,{kind:Ce.CHAPTERS});return Array.from((e=a?.cues)!=null?e:[]).map(({text:s,startTime:r,endTime:o})=>({text:wl(s),startTime:r,endTime:o}))},mediaEvents:["loadstart","loadedmetadata"],textTracksEvents:["addtrack","removetrack","change"],stateOwnersUpdateHandlers:[(t,e)=>{var i;const{media:a}=e;if(!a)return;const s=a.querySelector('track[kind="chapters"][default][src]'),r=(i=a.shadowRoot)==null?void 0:i.querySelector(':is(video,audio) > track[kind="chapters"][default][src]');return s?.addEventListener("load",t),r?.addEventListener("load",t),()=>{s?.removeEventListener("load",t),r?.removeEventListener("load",t)}}]},mediaIsPip:{get(t){var e,i;const{media:a,documentElement:s}=t;if(!a||!s||!s.pictureInPictureElement)return!1;if(s.pictureInPictureElement===a)return!0;if(s.pictureInPictureElement instanceof HTMLMediaElement)return(e=a.localName)!=null&&e.includes("-")?Nt(a,s.pictureInPictureElement):!1;if(s.pictureInPictureElement.localName.includes("-")){let r=s.pictureInPictureElement.shadowRoot;for(;r?.pictureInPictureElement;){if(r.pictureInPictureElement===a)return!0;r=(i=r.pictureInPictureElement)==null?void 0:i.shadowRoot}}return!1},set(t,e){const{media:i}=e;if(i)if(t){if(!re.pictureInPictureEnabled){console.warn("MediaChrome: Picture-in-picture is not enabled");return}if(!i.requestPictureInPicture){console.warn("MediaChrome: The current media does not support picture-in-picture");return}const a=()=>{console.warn("MediaChrome: The media is not ready for picture-in-picture. It must have a readyState > 0.")};i.requestPictureInPicture().catch(s=>{if(s.code===11){if(!i.src){console.warn("MediaChrome: The media is not ready for picture-in-picture. It must have a src set.");return}if(i.readyState===0&&i.preload==="none"){const r=()=>{i.removeEventListener("loadedmetadata",o),i.preload="none"},o=()=>{i.requestPictureInPicture().catch(a),r()};i.addEventListener("loadedmetadata",o),i.preload="metadata",setTimeout(()=>{i.readyState===0&&a(),r()},1e3)}else throw s}else throw s})}else re.pictureInPictureElement&&re.exitPictureInPicture()},mediaEvents:["enterpictureinpicture","leavepictureinpicture"]},mediaRenditionList:{get(t){var e;const{media:i}=t;return[...(e=i?.videoRenditions)!=null?e:[]].map(a=>({...a}))},mediaEvents:["emptied","loadstart"],videoRenditionsEvents:["addrendition","removerendition"]},mediaRenditionSelected:{get(t){var e,i,a;const{media:s}=t;return(a=(i=s?.videoRenditions)==null?void 0:i[(e=s.videoRenditions)==null?void 0:e.selectedIndex])==null?void 0:a.id},set(t,e){const{media:i}=e;if(!i?.videoRenditions){console.warn("MediaController: Rendition selection not supported by this media.");return}const a=t,s=Array.prototype.findIndex.call(i.videoRenditions,r=>r.id==a);i.videoRenditions.selectedIndex!=s&&(i.videoRenditions.selectedIndex=s)},mediaEvents:["emptied"],videoRenditionsEvents:["addrendition","removerendition","change"]},mediaAudioTrackList:{get(t){var e;const{media:i}=t;return[...(e=i?.audioTracks)!=null?e:[]]},mediaEvents:["emptied","loadstart"],audioTracksEvents:["addtrack","removetrack"]},mediaAudioTrackEnabled:{get(t){var e,i;const{media:a}=t;return(i=[...(e=a?.audioTracks)!=null?e:[]].find(s=>s.enabled))==null?void 0:i.id},set(t,e){const{media:i}=e;if(!i?.audioTracks){console.warn("MediaChrome: Audio track selection not supported by this media.");return}const a=t;for(const s of i.audioTracks)s.enabled=a==s.id},mediaEvents:["emptied"],audioTracksEvents:["addtrack","removetrack","change"]},mediaIsFullscreen:{get(t){return ml(t)},set(t,e,i){var a,s;t?(cl(e),i.detail&&!((a=e.media)!=null&&a.inert)&&((s=e.media)==null||s.focus())):ul(e)},rootEvents:["fullscreenchange","webkitfullscreenchange"],mediaEvents:["webkitbeginfullscreen","webkitendfullscreen","webkitpresentationmodechanged"]},mediaIsCasting:{get(t){var e;const{media:i}=t;return!i?.remote||((e=i.remote)==null?void 0:e.state)==="disconnected"?!1:i.remote.state==="connected"},set(t,e){var i,a;const{media:s}=e;if(s&&!(t&&((i=s.remote)==null?void 0:i.state)!=="disconnected")&&!(!t&&((a=s.remote)==null?void 0:a.state)!=="connected")){if(typeof s.remote.prompt!="function"){console.warn("MediaChrome: Casting is not supported in this environment");return}s.remote.prompt().catch(()=>{})}},remoteEvents:["connect","connecting","disconnect"]},mediaIsAirplaying:{get(){return!1},set(t,e){const{media:i}=e;if(i){if(!(i.webkitShowPlaybackTargetPicker&&l.WebKitPlaybackTargetAvailabilityEvent)){console.error("MediaChrome: received a request to select AirPlay but AirPlay is not supported in this environment");return}i.webkitShowPlaybackTargetPicker()}},mediaEvents:["webkitcurrentplaybacktargetiswirelesschanged"]},mediaFullscreenUnavailable:{get(t){const{media:e}=t;if(!bl||!Cn(e))return oe.UNSUPPORTED}},mediaPipUnavailable:{get(t){const{media:e}=t;if(!Al||!Dn(e))return oe.UNSUPPORTED;if(e?.disablePictureInPicture)return oe.UNAVAILABLE}},mediaVolumeUnavailable:{get(t){const{media:e}=t;if(la===!1||e?.volume==null)return oe.UNSUPPORTED},stateOwnersUpdateHandlers:[t=>{la==null&&kl.then(e=>t(e?void 0:oe.UNSUPPORTED))}]},mediaCastUnavailable:{get(t,{availability:e="not-available"}={}){var i;const{media:a}=t;if(!Il||!((i=a?.remote)!=null&&i.state))return oe.UNSUPPORTED;if(!(e==null||e==="available"))return oe.UNAVAILABLE},stateOwnersUpdateHandlers:[(t,e)=>{var i;const{media:a}=e;return a?(a.disableRemotePlayback||a.hasAttribute("disableremoteplayback")||(i=a?.remote)==null||i.watchAvailability(r=>{t({availability:r?"available":"not-available"})}).catch(r=>{r.name==="NotSupportedError"?t({availability:null}):t({availability:"not-available"})}),()=>{var r;(r=a?.remote)==null||r.cancelWatchAvailability().catch(()=>{})}):void 0}]},mediaAirplayUnavailable:{get(t,e){if(!Tl)return oe.UNSUPPORTED;if(e?.availability==="not-available")return oe.UNAVAILABLE},mediaEvents:["webkitplaybacktargetavailabilitychanged"],stateOwnersUpdateHandlers:[(t,e)=>{var i;const{media:a}=e;return a?(a.disableRemotePlayback||a.hasAttribute("disableremoteplayback")||(i=a?.remote)==null||i.watchAvailability(r=>{t({availability:r?"available":"not-available"})}).catch(r=>{r.name==="NotSupportedError"?t({availability:null}):t({availability:"not-available"})}),()=>{var r;(r=a?.remote)==null||r.cancelWatchAvailability().catch(()=>{})}):void 0}]},mediaRenditionUnavailable:{get(t){var e;const{media:i}=t;if(!i?.videoRenditions)return oe.UNSUPPORTED;if(!((e=i.videoRenditions)!=null&&e.length))return oe.UNAVAILABLE},mediaEvents:["emptied","loadstart"],videoRenditionsEvents:["addrendition","removerendition"]},mediaAudioTrackUnavailable:{get(t){var e,i;const{media:a}=t;if(!a?.audioTracks)return oe.UNSUPPORTED;if(((i=(e=a.audioTracks)==null?void 0:e.length)!=null?i:0)<=1)return oe.UNAVAILABLE},mediaEvents:["emptied","loadstart"],audioTracksEvents:["addtrack","removetrack"]},mediaLang:{get(t){const{options:{mediaLang:e}={}}=t;return e??"en"}}},Rl={[p.MEDIA_PREVIEW_REQUEST](t,e,{detail:i}){var a,s,r;const{media:o}=e,d=i??void 0;let c,y;if(o&&d!=null){const[m]=Ta(o,{kind:Ce.METADATA,label:"thumbnails"}),h=Array.prototype.find.call((a=m?.cues)!=null?a:[],(v,A,T)=>A===0?v.endTime>d:A===T.length-1?v.startTime<=d:v.startTime<=d&&v.endTime>d);if(h){const v=/'^(?:[a-z]+:)?\/\//i.test(h.text)||(s=o?.querySelector('track[label="thumbnails"]'))==null?void 0:s.src,A=new URL(h.text,v);y=new URLSearchParams(A.hash).get("#xywh").split(",").map(S=>+S),c=A.href}}const I=t.mediaDuration.get(e);let E=(r=t.mediaChaptersCues.get(e).find((m,h,v)=>h===v.length-1&&I===m.endTime?m.startTime<=d&&m.endTime>=d:m.startTime<=d&&m.endTime>d))==null?void 0:r.text;return i!=null&&E==null&&(E=""),{mediaPreviewTime:d,mediaPreviewImage:c,mediaPreviewCoords:y,mediaPreviewChapter:E}},[p.MEDIA_PAUSE_REQUEST](t,e){t["mediaPaused"].set(!0,e)},[p.MEDIA_PLAY_REQUEST](t,e){var i,a,s,r;const o="mediaPaused",c=t.mediaStreamType.get(e)===Ne.LIVE,y=!((i=e.options)!=null&&i.noAutoSeekToLive),I=t.mediaTargetLiveWindow.get(e)>0;if(c&&y&&!I){const g=(a=t.mediaSeekable.get(e))==null?void 0:a[1];if(g){const E=(r=(s=e.options)==null?void 0:s.seekToLiveOffset)!=null?r:0,m=g-E;t.mediaCurrentTime.set(m,e)}}t[o].set(!1,e)},[p.MEDIA_PLAYBACK_RATE_REQUEST](t,e,{detail:i}){const a="mediaPlaybackRate",s=i;t[a].set(s,e)},[p.MEDIA_MUTE_REQUEST](t,e){t["mediaMuted"].set(!0,e)},[p.MEDIA_UNMUTE_REQUEST](t,e){const i="mediaMuted";t.mediaVolume.get(e)||t.mediaVolume.set(.25,e),t[i].set(!1,e)},[p.MEDIA_LOOP_REQUEST](t,e,{detail:i}){const a="mediaLoop",s=!!i;return t[a].set(s,e),{mediaLoop:s}},[p.MEDIA_VOLUME_REQUEST](t,e,{detail:i}){const a="mediaVolume",s=i;s&&t.mediaMuted.get(e)&&t.mediaMuted.set(!1,e),t[a].set(s,e)},[p.MEDIA_SEEK_REQUEST](t,e,{detail:i}){const a="mediaCurrentTime",s=i;t[a].set(s,e)},[p.MEDIA_SEEK_TO_LIVE_REQUEST](t,e){var i,a,s;const r="mediaCurrentTime",o=(i=t.mediaSeekable.get(e))==null?void 0:i[1];if(Number.isNaN(Number(o)))return;const d=(s=(a=e.options)==null?void 0:a.seekToLiveOffset)!=null?s:0,c=o-d;t[r].set(c,e)},[p.MEDIA_SHOW_SUBTITLES_REQUEST](t,e,{detail:i}){var a;const{options:s}=e,r=oa(e),o=wn(i),d=(a=o[0])==null?void 0:a.language;d&&!s.noSubtitlesLangPref&&l.localStorage.setItem("media-chrome-pref-subtitles-lang",d),ri(Ct.SHOWING,r,o)},[p.MEDIA_DISABLE_SUBTITLES_REQUEST](t,e,{detail:i}){const a=oa(e),s=i??[];ri(Ct.DISABLED,a,s)},[p.MEDIA_TOGGLE_SUBTITLES_REQUEST](t,e,{detail:i}){On(e,i)},[p.MEDIA_RENDITION_REQUEST](t,e,{detail:i}){const a="mediaRenditionSelected",s=i;t[a].set(s,e)},[p.MEDIA_AUDIO_TRACK_REQUEST](t,e,{detail:i}){const a="mediaAudioTrackEnabled",s=i;t[a].set(s,e)},[p.MEDIA_ENTER_PIP_REQUEST](t,e){const i="mediaIsPip";t.mediaIsFullscreen.get(e)&&t.mediaIsFullscreen.set(!1,e),t[i].set(!0,e)},[p.MEDIA_EXIT_PIP_REQUEST](t,e){t["mediaIsPip"].set(!1,e)},[p.MEDIA_ENTER_FULLSCREEN_REQUEST](t,e,i){const a="mediaIsFullscreen";t.mediaIsPip.get(e)&&t.mediaIsPip.set(!1,e),t[a].set(!0,e,i)},[p.MEDIA_EXIT_FULLSCREEN_REQUEST](t,e){t["mediaIsFullscreen"].set(!1,e)},[p.MEDIA_ENTER_CAST_REQUEST](t,e){const i="mediaIsCasting";t.mediaIsFullscreen.get(e)&&t.mediaIsFullscreen.set(!1,e),t[i].set(!0,e)},[p.MEDIA_EXIT_CAST_REQUEST](t,e){t["mediaIsCasting"].set(!1,e)},[p.MEDIA_AIRPLAY_REQUEST](t,e){t["mediaIsAirplaying"].set(!0,e)}},Dl=({media:t,fullscreenElement:e,documentElement:i,stateMediator:a=qt,requestMap:s=Rl,options:r={},monitorStateOwnersOnlyWithSubscriptions:o=!0})=>{const d=[],c={options:{...r}};let y=Object.freeze({mediaPreviewTime:void 0,mediaPreviewImage:void 0,mediaPreviewCoords:void 0,mediaPreviewChapter:void 0});const I=v=>{v!=null&&(Ds(v,y)||(y=Object.freeze({...y,...v}),d.forEach(A=>A(y))))},g=()=>{const v=Object.entries(a).reduce((A,[T,{get:S}])=>(A[T]=S(c),A),{});I(v)},E={};let m;const h=async(v,A)=>{var T,S,w,N,z,V,de,Fe,ae,fi,Js,js,er,tr,ir,ar;const _o=!!m;if(m={...c,...m??{},...v},_o)return;await Ml(...Object.values(v));const lt=d.length>0&&A===0&&o,sr=c.media!==m.media,rr=((T=c.media)==null?void 0:T.textTracks)!==((S=m.media)==null?void 0:S.textTracks),nr=((w=c.media)==null?void 0:w.videoRenditions)!==((N=m.media)==null?void 0:N.videoRenditions),or=((z=c.media)==null?void 0:z.audioTracks)!==((V=m.media)==null?void 0:V.audioTracks),lr=((de=c.media)==null?void 0:de.remote)!==((Fe=m.media)==null?void 0:Fe.remote),dr=c.documentElement!==m.documentElement,cr=!!c.media&&(sr||lt),ur=!!((ae=c.media)!=null&&ae.textTracks)&&(rr||lt),hr=!!((fi=c.media)!=null&&fi.videoRenditions)&&(nr||lt),mr=!!((Js=c.media)!=null&&Js.audioTracks)&&(or||lt),pr=!!((js=c.media)!=null&&js.remote)&&(lr||lt),Er=!!c.documentElement&&(dr||lt),Va=cr||ur||hr||mr||pr||Er,dt=d.length===0&&A===1&&o,vr=!!m.media&&(sr||dt),fr=!!((er=m.media)!=null&&er.textTracks)&&(rr||dt),_r=!!((tr=m.media)!=null&&tr.videoRenditions)&&(nr||dt),gr=!!((ir=m.media)!=null&&ir.audioTracks)&&(or||dt),br=!!((ar=m.media)!=null&&ar.remote)&&(lr||dt),Ar=!!m.documentElement&&(dr||dt),Tr=vr||fr||_r||gr||br||Ar;if(!(Va||Tr)){Object.entries(m).forEach(([O,$t])=>{c[O]=$t}),g(),m=void 0;return}Object.entries(a).forEach(([O,{get:$t,mediaEvents:go=[],textTracksEvents:bo=[],videoRenditionsEvents:Ao=[],audioTracksEvents:To=[],remoteEvents:Io=[],rootEvents:yo=[],stateOwnersUpdateHandlers:So=[]}])=>{E[O]||(E[O]={});const ne=U=>{const K=$t(c,U);I({[O]:K})};let Z;Z=E[O].mediaEvents,go.forEach(U=>{Z&&cr&&(c.media.removeEventListener(U,Z),E[O].mediaEvents=void 0),vr&&(m.media.addEventListener(U,ne),E[O].mediaEvents=ne)}),Z=E[O].textTracksEvents,bo.forEach(U=>{var K,me;Z&&ur&&((K=c.media.textTracks)==null||K.removeEventListener(U,Z),E[O].textTracksEvents=void 0),fr&&((me=m.media.textTracks)==null||me.addEventListener(U,ne),E[O].textTracksEvents=ne)}),Z=E[O].videoRenditionsEvents,Ao.forEach(U=>{var K,me;Z&&hr&&((K=c.media.videoRenditions)==null||K.removeEventListener(U,Z),E[O].videoRenditionsEvents=void 0),_r&&((me=m.media.videoRenditions)==null||me.addEventListener(U,ne),E[O].videoRenditionsEvents=ne)}),Z=E[O].audioTracksEvents,To.forEach(U=>{var K,me;Z&&mr&&((K=c.media.audioTracks)==null||K.removeEventListener(U,Z),E[O].audioTracksEvents=void 0),gr&&((me=m.media.audioTracks)==null||me.addEventListener(U,ne),E[O].audioTracksEvents=ne)}),Z=E[O].remoteEvents,Io.forEach(U=>{var K,me;Z&&pr&&((K=c.media.remote)==null||K.removeEventListener(U,Z),E[O].remoteEvents=void 0),br&&((me=m.media.remote)==null||me.addEventListener(U,ne),E[O].remoteEvents=ne)}),Z=E[O].rootEvents,yo.forEach(U=>{Z&&Er&&(c.documentElement.removeEventListener(U,Z),E[O].rootEvents=void 0),Ar&&(m.documentElement.addEventListener(U,ne),E[O].rootEvents=ne)});const _i=E[O].stateOwnersUpdateHandlers;if(_i&&Va&&(Array.isArray(_i)?_i:[_i]).forEach(K=>{typeof K=="function"&&K()}),Tr){const U=So.map(K=>K(ne,m)).filter(K=>typeof K=="function");E[O].stateOwnersUpdateHandlers=U.length===1?U[0]:U}else Va&&(E[O].stateOwnersUpdateHandlers=void 0)}),Object.entries(m).forEach(([O,$t])=>{c[O]=$t}),g(),m=void 0};return h({media:t,fullscreenElement:e,documentElement:i,options:r}),{dispatch(v){const{type:A,detail:T}=v;if(s[A]&&y.mediaErrorCode==null){I(s[A](a,c,v));return}A==="mediaelementchangerequest"?h({media:T}):A==="fullscreenelementchangerequest"?h({fullscreenElement:T}):A==="documentelementchangerequest"?h({documentElement:T}):A==="optionschangerequest"&&(Object.entries(T??{}).forEach(([S,w])=>{c.options[S]=w}),g())},getState(){return y},subscribe(v){return h({},d.length+1),d.push(v),v(y),()=>{const A=d.indexOf(v);A>=0&&(h({},d.length-1),d.splice(A,1))}}}};var Cs=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},_=(t,e,i)=>(Cs(t,e,"read from private field"),i?i.call(t):e.get(t)),ce=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},ve=(t,e,i,a)=>(Cs(t,e,"write to private field"),e.set(t,i),i),Ft=(t,e,i)=>(Cs(t,e,"access private method"),i),$e,Yt,k,De,Qt,ye,Pi,zt,Oi,es,at,xi,ts,is,xn;const Un=["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Enter"," ","f","m","k","c","l","j",">","<","p"],Dr=10,Cr=.025,Pr=.25,Cl=.25,Pl=2,u={DEFAULT_SUBTITLES:"defaultsubtitles",DEFAULT_STREAM_TYPE:"defaultstreamtype",DEFAULT_DURATION:"defaultduration",FULLSCREEN_ELEMENT:"fullscreenelement",HOTKEYS:"hotkeys",KEYBOARD_BACKWARD_SEEK_OFFSET:"keyboardbackwardseekoffset",KEYBOARD_FORWARD_SEEK_OFFSET:"keyboardforwardseekoffset",KEYBOARD_DOWN_VOLUME_STEP:"keyboarddownvolumestep",KEYBOARD_UP_VOLUME_STEP:"keyboardupvolumestep",KEYS_USED:"keysused",LANG:"lang",LOOP:"loop",LIVE_EDGE_OFFSET:"liveedgeoffset",NO_AUTO_SEEK_TO_LIVE:"noautoseektolive",NO_DEFAULT_STORE:"nodefaultstore",NO_HOTKEYS:"nohotkeys",NO_MUTED_PREF:"nomutedpref",NO_SUBTITLES_LANG_PREF:"nosubtitleslangpref",NO_VOLUME_PREF:"novolumepref",SEEK_TO_LIVE_OFFSET:"seektoliveoffset"};let Nn=class extends vi{constructor(){super(),ce(this,Oi),ce(this,xi),ce(this,is),this.mediaStateReceivers=[],this.associatedElementSubscriptions=new Map,ce(this,$e,new kn(this,u.HOTKEYS)),ce(this,Yt,void 0),ce(this,k,void 0),ce(this,De,null),ce(this,Qt,void 0),ce(this,ye,void 0),ce(this,Pi,i=>{var a;(a=_(this,k))==null||a.dispatch(i)}),ce(this,zt,void 0),ce(this,at,i=>{const{key:a,shiftKey:s}=i;if(!(s&&(a==="/"||a==="?")||Un.includes(a))){this.removeEventListener("keyup",_(this,at));return}this.keyboardShortcutHandler(i)}),this.associateElement(this);let e={};ve(this,Qt,i=>{Object.entries(i).forEach(([a,s])=>{if(a in e&&e[a]===s)return;this.propagateMediaState(a,s);const r=a.toLowerCase(),o=new l.CustomEvent(Co[r],{composed:!0,detail:s});this.dispatchEvent(o)}),e=i})}static get observedAttributes(){return super.observedAttributes.concat(u.NO_HOTKEYS,u.HOTKEYS,u.DEFAULT_STREAM_TYPE,u.DEFAULT_SUBTITLES,u.DEFAULT_DURATION,u.NO_MUTED_PREF,u.NO_VOLUME_PREF,u.LANG,u.LOOP,u.LIVE_EDGE_OFFSET,u.SEEK_TO_LIVE_OFFSET,u.NO_AUTO_SEEK_TO_LIVE)}get mediaStore(){return _(this,k)}set mediaStore(e){var i,a;if(_(this,k)&&((i=_(this,ye))==null||i.call(this),ve(this,ye,void 0)),ve(this,k,e),!_(this,k)&&!this.hasAttribute(u.NO_DEFAULT_STORE)){Ft(this,Oi,es).call(this);return}ve(this,ye,(a=_(this,k))==null?void 0:a.subscribe(_(this,Qt)))}get fullscreenElement(){var e;return(e=_(this,Yt))!=null?e:this}set fullscreenElement(e){var i;this.hasAttribute(u.FULLSCREEN_ELEMENT)&&this.removeAttribute(u.FULLSCREEN_ELEMENT),ve(this,Yt,e),(i=_(this,k))==null||i.dispatch({type:"fullscreenelementchangerequest",detail:this.fullscreenElement})}get defaultSubtitles(){return M(this,u.DEFAULT_SUBTITLES)}set defaultSubtitles(e){L(this,u.DEFAULT_SUBTITLES,e)}get defaultStreamType(){return B(this,u.DEFAULT_STREAM_TYPE)}set defaultStreamType(e){F(this,u.DEFAULT_STREAM_TYPE,e)}get defaultDuration(){return H(this,u.DEFAULT_DURATION)}set defaultDuration(e){j(this,u.DEFAULT_DURATION,e)}get noHotkeys(){return M(this,u.NO_HOTKEYS)}set noHotkeys(e){L(this,u.NO_HOTKEYS,e)}get keysUsed(){return B(this,u.KEYS_USED)}set keysUsed(e){F(this,u.KEYS_USED,e)}get liveEdgeOffset(){return H(this,u.LIVE_EDGE_OFFSET)}set liveEdgeOffset(e){j(this,u.LIVE_EDGE_OFFSET,e)}get noAutoSeekToLive(){return M(this,u.NO_AUTO_SEEK_TO_LIVE)}set noAutoSeekToLive(e){L(this,u.NO_AUTO_SEEK_TO_LIVE,e)}get noVolumePref(){return M(this,u.NO_VOLUME_PREF)}set noVolumePref(e){L(this,u.NO_VOLUME_PREF,e)}get noMutedPref(){return M(this,u.NO_MUTED_PREF)}set noMutedPref(e){L(this,u.NO_MUTED_PREF,e)}get noSubtitlesLangPref(){return M(this,u.NO_SUBTITLES_LANG_PREF)}set noSubtitlesLangPref(e){L(this,u.NO_SUBTITLES_LANG_PREF,e)}get noDefaultStore(){return M(this,u.NO_DEFAULT_STORE)}set noDefaultStore(e){L(this,u.NO_DEFAULT_STORE,e)}get resolvedLang(){return Wo()}attributeChangedCallback(e,i,a){var s,r,o,d,c,y,I,g,E,m,h,v;if(super.attributeChangedCallback(e,i,a),e===u.NO_HOTKEYS)a!==i&&a===""?(this.hasAttribute(u.HOTKEYS)&&console.warn("Media Chrome: Both `hotkeys` and `nohotkeys` have been set. All hotkeys will be disabled."),this.disableHotkeys()):a!==i&&a===null&&this.enableHotkeys();else if(e===u.HOTKEYS)_(this,$e).value=a;else if(e===u.DEFAULT_SUBTITLES&&a!==i)(s=_(this,k))==null||s.dispatch({type:"optionschangerequest",detail:{defaultSubtitles:this.hasAttribute(u.DEFAULT_SUBTITLES)}});else if(e===u.DEFAULT_STREAM_TYPE)(o=_(this,k))==null||o.dispatch({type:"optionschangerequest",detail:{defaultStreamType:(r=this.getAttribute(u.DEFAULT_STREAM_TYPE))!=null?r:void 0}});else if(e===u.LIVE_EDGE_OFFSET&&a!==i)(d=_(this,k))==null||d.dispatch({type:"optionschangerequest",detail:{liveEdgeOffset:this.hasAttribute(u.LIVE_EDGE_OFFSET)?+this.getAttribute(u.LIVE_EDGE_OFFSET):void 0,seekToLiveOffset:this.hasAttribute(u.SEEK_TO_LIVE_OFFSET)?+this.getAttribute(u.SEEK_TO_LIVE_OFFSET):this.hasAttribute(u.LIVE_EDGE_OFFSET)?+this.getAttribute(u.LIVE_EDGE_OFFSET):void 0}});else if(e===u.SEEK_TO_LIVE_OFFSET&&a!==i)(c=_(this,k))==null||c.dispatch({type:"optionschangerequest",detail:{seekToLiveOffset:this.hasAttribute(u.SEEK_TO_LIVE_OFFSET)?+this.getAttribute(u.SEEK_TO_LIVE_OFFSET):this.hasAttribute(u.LIVE_EDGE_OFFSET)?+this.getAttribute(u.LIVE_EDGE_OFFSET):void 0}});else if(e===u.NO_AUTO_SEEK_TO_LIVE)(y=_(this,k))==null||y.dispatch({type:"optionschangerequest",detail:{noAutoSeekToLive:this.hasAttribute(u.NO_AUTO_SEEK_TO_LIVE)}});else if(e===u.FULLSCREEN_ELEMENT){const A=a?(I=this.getRootNode())==null?void 0:I.getElementById(a):void 0;ve(this,Yt,A),(g=_(this,k))==null||g.dispatch({type:"fullscreenelementchangerequest",detail:this.fullscreenElement})}else e===u.LANG&&a!==i?(Ho(a),(E=_(this,k))==null||E.dispatch({type:"optionschangerequest",detail:{mediaLang:a}})):e===u.LOOP&&a!==i?(m=_(this,k))==null||m.dispatch({type:p.MEDIA_LOOP_REQUEST,detail:a!=null}):e===u.NO_VOLUME_PREF&&a!==i?(h=_(this,k))==null||h.dispatch({type:"optionschangerequest",detail:{noVolumePref:this.hasAttribute(u.NO_VOLUME_PREF)}}):e===u.NO_MUTED_PREF&&a!==i&&((v=_(this,k))==null||v.dispatch({type:"optionschangerequest",detail:{noMutedPref:this.hasAttribute(u.NO_MUTED_PREF)}}))}connectedCallback(){var e,i,a;this.associateElement(this),!_(this,k)&&!this.hasAttribute(u.NO_DEFAULT_STORE)&&Ft(this,Oi,es).call(this),(e=_(this,k))==null||e.dispatch({type:"documentelementchangerequest",detail:re}),(i=_(this,k))==null||i.dispatch({type:"fullscreenelementchangerequest",detail:this.fullscreenElement}),super.connectedCallback(),_(this,k)&&!_(this,ye)&&ve(this,ye,(a=_(this,k))==null?void 0:a.subscribe(_(this,Qt))),_(this,zt)!==void 0&&_(this,k)&&this.media&&setTimeout(()=>{var s,r,o;(r=(s=this.media)==null?void 0:s.textTracks)!=null&&r.length&&((o=_(this,k))==null||o.dispatch({type:p.MEDIA_TOGGLE_SUBTITLES_REQUEST,detail:_(this,zt)}))},0),this.hasAttribute(u.NO_HOTKEYS)?this.disableHotkeys():this.enableHotkeys()}disconnectedCallback(){var e,i,a,s,r,o;if((e=super.disconnectedCallback)==null||e.call(this),this.disableHotkeys(),_(this,k)){const d=_(this,k).getState();ve(this,zt,!!((i=d.mediaSubtitlesShowing)!=null&&i.length)),(a=_(this,k))==null||a.dispatch({type:"fullscreenelementchangerequest",detail:void 0}),(s=_(this,k))==null||s.dispatch({type:"documentelementchangerequest",detail:void 0}),(r=_(this,k))==null||r.dispatch({type:p.MEDIA_TOGGLE_SUBTITLES_REQUEST,detail:!1})}_(this,ye)&&((o=_(this,ye))==null||o.call(this),ve(this,ye,void 0)),this.unassociateElement(this),_(this,De)&&(_(this,De).remove(),ve(this,De,null))}mediaSetCallback(e){var i;super.mediaSetCallback(e),(i=_(this,k))==null||i.dispatch({type:"mediaelementchangerequest",detail:e}),e.hasAttribute("tabindex")||(e.tabIndex=-1)}mediaUnsetCallback(e){var i;super.mediaUnsetCallback(e),(i=_(this,k))==null||i.dispatch({type:"mediaelementchangerequest",detail:void 0})}propagateMediaState(e,i){Ur(this.mediaStateReceivers,e,i)}associateElement(e){if(!e)return;const{associatedElementSubscriptions:i}=this;if(i.has(e))return;const a=this.registerMediaStateReceiver.bind(this),s=this.unregisterMediaStateReceiver.bind(this),r=Hl(e,a,s);Object.values(p).forEach(o=>{e.addEventListener(o,_(this,Pi))}),i.set(e,r)}unassociateElement(e){if(!e)return;const{associatedElementSubscriptions:i}=this;if(!i.has(e))return;i.get(e)(),i.delete(e),Object.values(p).forEach(s=>{e.removeEventListener(s,_(this,Pi))})}registerMediaStateReceiver(e){if(!e)return;const i=this.mediaStateReceivers;i.indexOf(e)>-1||(i.push(e),_(this,k)&&Object.entries(_(this,k).getState()).forEach(([s,r])=>{Ur([e],s,r)}))}unregisterMediaStateReceiver(e){const i=this.mediaStateReceivers,a=i.indexOf(e);a<0||i.splice(a,1)}enableHotkeys(){this.addEventListener("keydown",Ft(this,xi,ts))}disableHotkeys(){this.removeEventListener("keydown",Ft(this,xi,ts)),this.removeEventListener("keyup",_(this,at))}get hotkeys(){return _(this,$e)}set hotkeys(e){F(this,u.HOTKEYS,e)}keyboardShortcutHandler(e){var i,a,s,r,o,d,c,y,I;const g=e.target;if(((s=(a=(i=g.getAttribute(u.KEYS_USED))==null?void 0:i.split(" "))!=null?a:g?.keysUsed)!=null?s:[]).map(T=>T==="Space"?" ":T).filter(Boolean).includes(e.key))return;let m,h,v;if(!(_(this,$e).contains(`no${e.key.toLowerCase()}`)||e.key===" "&&_(this,$e).contains("nospace")||e.shiftKey&&(e.key==="/"||e.key==="?")&&_(this,$e).contains("noshift+/")))switch(e.key){case" ":case"k":m=_(this,k).getState().mediaPaused?p.MEDIA_PLAY_REQUEST:p.MEDIA_PAUSE_REQUEST,this.dispatchEvent(new l.CustomEvent(m,{composed:!0,bubbles:!0}));break;case"m":m=this.mediaStore.getState().mediaVolumeLevel==="off"?p.MEDIA_UNMUTE_REQUEST:p.MEDIA_MUTE_REQUEST,this.dispatchEvent(new l.CustomEvent(m,{composed:!0,bubbles:!0}));break;case"f":m=this.mediaStore.getState().mediaIsFullscreen?p.MEDIA_EXIT_FULLSCREEN_REQUEST:p.MEDIA_ENTER_FULLSCREEN_REQUEST,this.dispatchEvent(new l.CustomEvent(m,{composed:!0,bubbles:!0}));break;case"c":this.dispatchEvent(new l.CustomEvent(p.MEDIA_TOGGLE_SUBTITLES_REQUEST,{composed:!0,bubbles:!0}));break;case"ArrowLeft":case"j":{const T=this.hasAttribute(u.KEYBOARD_BACKWARD_SEEK_OFFSET)?+this.getAttribute(u.KEYBOARD_BACKWARD_SEEK_OFFSET):Dr;h=Math.max(((r=this.mediaStore.getState().mediaCurrentTime)!=null?r:0)-T,0),v=new l.CustomEvent(p.MEDIA_SEEK_REQUEST,{composed:!0,bubbles:!0,detail:h}),this.dispatchEvent(v);break}case"ArrowRight":case"l":{const T=this.hasAttribute(u.KEYBOARD_FORWARD_SEEK_OFFSET)?+this.getAttribute(u.KEYBOARD_FORWARD_SEEK_OFFSET):Dr;h=Math.max(((o=this.mediaStore.getState().mediaCurrentTime)!=null?o:0)+T,0),v=new l.CustomEvent(p.MEDIA_SEEK_REQUEST,{composed:!0,bubbles:!0,detail:h}),this.dispatchEvent(v);break}case"ArrowUp":{const T=this.hasAttribute(u.KEYBOARD_UP_VOLUME_STEP)?+this.getAttribute(u.KEYBOARD_UP_VOLUME_STEP):Cr;h=Math.min(((d=this.mediaStore.getState().mediaVolume)!=null?d:1)+T,1),v=new l.CustomEvent(p.MEDIA_VOLUME_REQUEST,{composed:!0,bubbles:!0,detail:h}),this.dispatchEvent(v);break}case"ArrowDown":{const T=this.hasAttribute(u.KEYBOARD_DOWN_VOLUME_STEP)?+this.getAttribute(u.KEYBOARD_DOWN_VOLUME_STEP):Cr;h=Math.max(((c=this.mediaStore.getState().mediaVolume)!=null?c:1)-T,0),v=new l.CustomEvent(p.MEDIA_VOLUME_REQUEST,{composed:!0,bubbles:!0,detail:h}),this.dispatchEvent(v);break}case"<":{const T=(y=this.mediaStore.getState().mediaPlaybackRate)!=null?y:1;h=Math.max(T-Pr,Cl).toFixed(2),v=new l.CustomEvent(p.MEDIA_PLAYBACK_RATE_REQUEST,{composed:!0,bubbles:!0,detail:h}),this.dispatchEvent(v);break}case">":{const T=(I=this.mediaStore.getState().mediaPlaybackRate)!=null?I:1;h=Math.min(T+Pr,Pl).toFixed(2),v=new l.CustomEvent(p.MEDIA_PLAYBACK_RATE_REQUEST,{composed:!0,bubbles:!0,detail:h}),this.dispatchEvent(v);break}case"/":case"?":{e.shiftKey&&Ft(this,is,xn).call(this);break}case"p":{m=this.mediaStore.getState().mediaIsPip?p.MEDIA_EXIT_PIP_REQUEST:p.MEDIA_ENTER_PIP_REQUEST,v=new l.CustomEvent(m,{composed:!0,bubbles:!0}),this.dispatchEvent(v);break}}}};$e=new WeakMap;Yt=new WeakMap;k=new WeakMap;De=new WeakMap;Qt=new WeakMap;ye=new WeakMap;Pi=new WeakMap;zt=new WeakMap;Oi=new WeakSet;es=function(){var t;this.mediaStore=Dl({media:this.media,fullscreenElement:this.fullscreenElement,options:{defaultSubtitles:this.hasAttribute(u.DEFAULT_SUBTITLES),defaultDuration:this.hasAttribute(u.DEFAULT_DURATION)?+this.getAttribute(u.DEFAULT_DURATION):void 0,defaultStreamType:(t=this.getAttribute(u.DEFAULT_STREAM_TYPE))!=null?t:void 0,liveEdgeOffset:this.hasAttribute(u.LIVE_EDGE_OFFSET)?+this.getAttribute(u.LIVE_EDGE_OFFSET):void 0,seekToLiveOffset:this.hasAttribute(u.SEEK_TO_LIVE_OFFSET)?+this.getAttribute(u.SEEK_TO_LIVE_OFFSET):this.hasAttribute(u.LIVE_EDGE_OFFSET)?+this.getAttribute(u.LIVE_EDGE_OFFSET):void 0,noAutoSeekToLive:this.hasAttribute(u.NO_AUTO_SEEK_TO_LIVE),noVolumePref:this.hasAttribute(u.NO_VOLUME_PREF),noMutedPref:this.hasAttribute(u.NO_MUTED_PREF),noSubtitlesLangPref:this.hasAttribute(u.NO_SUBTITLES_LANG_PREF)}})};at=new WeakMap;xi=new WeakSet;ts=function(t){var e;const{metaKey:i,altKey:a,key:s,shiftKey:r}=t,o=r&&(s==="/"||s==="?");if(o&&((e=_(this,De))!=null&&e.open)){this.removeEventListener("keyup",_(this,at));return}if(i||a||!o&&!Un.includes(s)){this.removeEventListener("keyup",_(this,at));return}const d=t.target,c=d instanceof HTMLElement&&(d.tagName.toLowerCase()==="media-volume-range"||d.tagName.toLowerCase()==="media-time-range");[" ","ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(s)&&!(_(this,$e).contains(`no${s.toLowerCase()}`)||s===" "&&_(this,$e).contains("nospace"))&&!c&&t.preventDefault(),this.addEventListener("keyup",_(this,at),{once:!0})};is=new WeakSet;xn=function(){_(this,De)||(ve(this,De,re.createElement("media-keyboard-shortcuts-dialog")),this.appendChild(_(this,De))),_(this,De).open=!0};const Ol=Object.values(n),xl=Object.values(rn),$n=t=>{var e,i,a,s;let{observedAttributes:r}=t.constructor;!r&&((e=t.nodeName)!=null&&e.includes("-"))&&(l.customElements.upgrade(t),{observedAttributes:r}=t.constructor);const o=(s=(a=(i=t?.getAttribute)==null?void 0:i.call(t,P.MEDIA_CHROME_ATTRIBUTES))==null?void 0:a.split)==null?void 0:s.call(a,/\s+/);return Array.isArray(r||o)?(r||o).filter(d=>Ol.includes(d)):[]},Ul=t=>{var e,i;return(e=t.nodeName)!=null&&e.includes("-")&&l.customElements.get((i=t.nodeName)==null?void 0:i.toLowerCase())&&!(t instanceof l.customElements.get(t.nodeName.toLowerCase()))&&l.customElements.upgrade(t),xl.some(a=>a in t)},as=t=>Ul(t)||!!$n(t).length,Or=t=>{var e;return(e=t?.join)==null?void 0:e.call(t,":")},xr={[n.MEDIA_SUBTITLES_LIST]:ja,[n.MEDIA_SUBTITLES_SHOWING]:ja,[n.MEDIA_SEEKABLE]:Or,[n.MEDIA_BUFFERED]:t=>t?.map(Or).join(" "),[n.MEDIA_PREVIEW_COORDS]:t=>t?.join(" "),[n.MEDIA_RENDITION_LIST]:Oo,[n.MEDIA_AUDIO_TRACK_LIST]:Uo},Nl=async(t,e,i)=>{var a,s;if(t.isConnected||await on(0),typeof i=="boolean"||i==null)return L(t,e,i);if(typeof i=="number")return j(t,e,i);if(typeof i=="string")return F(t,e,i);if(Array.isArray(i)&&!i.length)return t.removeAttribute(e);const r=(s=(a=xr[e])==null?void 0:a.call(xr,i))!=null?s:i;return t.setAttribute(e,r)},$l=t=>{var e;return!!((e=t.closest)!=null&&e.call(t,'*[slot="media"]'))},et=(t,e)=>{if($l(t))return;const i=(s,r)=>{var o,d;as(s)&&r(s);const{children:c=[]}=s??{},y=(d=(o=s?.shadowRoot)==null?void 0:o.children)!=null?d:[];[...c,...y].forEach(g=>et(g,r))},a=t?.nodeName.toLowerCase();if(a.includes("-")&&!as(t)){l.customElements.whenDefined(a).then(()=>{i(t,e)});return}i(t,e)},Ur=(t,e,i)=>{t.forEach(a=>{if(e in a){a[e]=i;return}const s=$n(a),r=e.toLowerCase();s.includes(r)&&Nl(a,r,i)})},Hl=(t,e,i)=>{et(t,e);const a=I=>{var g;const E=(g=I?.composedPath()[0])!=null?g:I.target;e(E)},s=I=>{var g;const E=(g=I?.composedPath()[0])!=null?g:I.target;i(E)};t.addEventListener(p.REGISTER_MEDIA_STATE_RECEIVER,a),t.addEventListener(p.UNREGISTER_MEDIA_STATE_RECEIVER,s);const r=I=>{I.forEach(g=>{const{addedNodes:E=[],removedNodes:m=[],type:h,target:v,attributeName:A}=g;h==="childList"?(Array.prototype.forEach.call(E,T=>et(T,e)),Array.prototype.forEach.call(m,T=>et(T,i))):h==="attributes"&&A===P.MEDIA_CHROME_ATTRIBUTES&&(as(v)?e(v):i(v))})};let o=[];const d=I=>{const g=I.target;g.name!=="media"&&(o.forEach(E=>et(E,i)),o=[...g.assignedElements({flatten:!0})],o.forEach(E=>et(E,e)))};t.addEventListener("slotchange",d);const c=new MutationObserver(r);return c.observe(t,{childList:!0,attributes:!0,subtree:!0}),()=>{et(t,i),t.removeEventListener("slotchange",d),c.disconnect(),t.removeEventListener(p.REGISTER_MEDIA_STATE_RECEIVER,a),t.removeEventListener(p.UNREGISTER_MEDIA_STATE_RECEIVER,s)}};l.customElements.get("media-controller")||l.customElements.define("media-controller",Nn);var Fl=Nn;const ct={PLACEMENT:"placement",BOUNDS:"bounds"};function Wl(t){return`
    <style>
      :host {
        --_tooltip-background-color: var(--media-tooltip-background-color, var(--media-secondary-color, rgba(20, 20, 30, .7)));
        --_tooltip-background: var(--media-tooltip-background, var(--_tooltip-background-color));
        --_tooltip-arrow-half-width: calc(var(--media-tooltip-arrow-width, 12px) / 2);
        --_tooltip-arrow-height: var(--media-tooltip-arrow-height, 5px);
        --_tooltip-arrow-background: var(--media-tooltip-arrow-color, var(--_tooltip-background-color));
        position: relative;
        pointer-events: none;
        display: var(--media-tooltip-display, inline-flex);
        justify-content: center;
        align-items: center;
        box-sizing: border-box;
        z-index: var(--media-tooltip-z-index, 1);
        background: var(--_tooltip-background);
        color: var(--media-text-color, var(--media-primary-color, rgb(238 238 238)));
        font: var(--media-font,
          var(--media-font-weight, 400)
          var(--media-font-size, 13px) /
          var(--media-text-content-height, var(--media-control-height, 18px))
          var(--media-font-family, helvetica neue, segoe ui, roboto, arial, sans-serif));
        padding: var(--media-tooltip-padding, .35em .7em);
        border: var(--media-tooltip-border, none);
        border-radius: var(--media-tooltip-border-radius, 5px);
        filter: var(--media-tooltip-filter, drop-shadow(0 0 4px rgba(0, 0, 0, .2)));
        white-space: var(--media-tooltip-white-space, nowrap);
      }

      :host([hidden]) {
        display: none;
      }

      img, svg {
        display: inline-block;
      }

      #arrow {
        position: absolute;
        width: 0px;
        height: 0px;
        border-style: solid;
        display: var(--media-tooltip-arrow-display, block);
      }

      :host(:not([placement])),
      :host([placement="top"]) {
        position: absolute;
        bottom: calc(100% + var(--media-tooltip-distance, 12px));
        left: 50%;
        transform: translate(calc(-50% - var(--media-tooltip-offset-x, 0px)), 0);
      }
      :host(:not([placement])) #arrow,
      :host([placement="top"]) #arrow {
        top: 100%;
        left: 50%;
        border-width: var(--_tooltip-arrow-height) var(--_tooltip-arrow-half-width) 0 var(--_tooltip-arrow-half-width);
        border-color: var(--_tooltip-arrow-background) transparent transparent transparent;
        transform: translate(calc(-50% + var(--media-tooltip-offset-x, 0px)), 0);
      }

      :host([placement="right"]) {
        position: absolute;
        left: calc(100% + var(--media-tooltip-distance, 12px));
        top: 50%;
        transform: translate(0, -50%);
      }
      :host([placement="right"]) #arrow {
        top: 50%;
        right: 100%;
        border-width: var(--_tooltip-arrow-half-width) var(--_tooltip-arrow-height) var(--_tooltip-arrow-half-width) 0;
        border-color: transparent var(--_tooltip-arrow-background) transparent transparent;
        transform: translate(0, -50%);
      }

      :host([placement="bottom"]) {
        position: absolute;
        top: calc(100% + var(--media-tooltip-distance, 12px));
        left: 50%;
        transform: translate(calc(-50% - var(--media-tooltip-offset-x, 0px)), 0);
      }
      :host([placement="bottom"]) #arrow {
        bottom: 100%;
        left: 50%;
        border-width: 0 var(--_tooltip-arrow-half-width) var(--_tooltip-arrow-height) var(--_tooltip-arrow-half-width);
        border-color: transparent transparent var(--_tooltip-arrow-background) transparent;
        transform: translate(calc(-50% + var(--media-tooltip-offset-x, 0px)), 0);
      }

      :host([placement="left"]) {
        position: absolute;
        right: calc(100% + var(--media-tooltip-distance, 12px));
        top: 50%;
        transform: translate(0, -50%);
      }
      :host([placement="left"]) #arrow {
        top: 50%;
        left: 100%;
        border-width: var(--_tooltip-arrow-half-width) 0 var(--_tooltip-arrow-half-width) var(--_tooltip-arrow-height);
        border-color: transparent transparent transparent var(--_tooltip-arrow-background);
        transform: translate(0, -50%);
      }
      
      :host([placement="none"]) #arrow {
        display: none;
      }
    </style>
    <slot></slot>
    <div id="arrow"></div>
  `}class Ia extends l.HTMLElement{constructor(){if(super(),this.updateXOffset=()=>{var e;if(!gn(this,{checkOpacity:!1,checkVisibilityCSS:!1}))return;const i=this.placement;if(i==="left"||i==="right"){this.style.removeProperty("--media-tooltip-offset-x");return}const a=getComputedStyle(this),s=(e=Ei(this,"#"+this.bounds))!=null?e:Ko(this);if(!s)return;const{x:r,width:o}=s.getBoundingClientRect(),{x:d,width:c}=this.getBoundingClientRect(),y=d+c,I=r+o,g=a.getPropertyValue("--media-tooltip-offset-x"),E=g?parseFloat(g.replace("px","")):0,m=a.getPropertyValue("--media-tooltip-container-margin"),h=m?parseFloat(m.replace("px","")):0,v=d-r+E-h,A=y-I+E+h;if(v<0){this.style.setProperty("--media-tooltip-offset-x",`${v}px`);return}if(A>0){this.style.setProperty("--media-tooltip-offset-x",`${A}px`);return}this.style.removeProperty("--media-tooltip-offset-x")},!this.shadowRoot){this.attachShadow(this.constructor.shadowRootOptions);const e=Ae(this.attributes);this.shadowRoot.innerHTML=this.constructor.getTemplateHTML(e)}if(this.arrowEl=this.shadowRoot.querySelector("#arrow"),Object.prototype.hasOwnProperty.call(this,"placement")){const e=this.placement;delete this.placement,this.placement=e}}static get observedAttributes(){return[ct.PLACEMENT,ct.BOUNDS]}get placement(){return B(this,ct.PLACEMENT)}set placement(e){F(this,ct.PLACEMENT,e)}get bounds(){return B(this,ct.BOUNDS)}set bounds(e){F(this,ct.BOUNDS,e)}}Ia.shadowRootOptions={mode:"open"};Ia.getTemplateHTML=Wl;l.customElements.get("media-tooltip")||l.customElements.define("media-tooltip",Ia);var ss=Ia,Ps=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},G=(t,e,i)=>(Ps(t,e,"read from private field"),i?i.call(t):e.get(t)),ut=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},Ti=(t,e,i,a)=>(Ps(t,e,"write to private field"),e.set(t,i),i),Bl=(t,e,i)=>(Ps(t,e,"access private method"),i),Se,Dt,Ze,bt,Ui,rs,Hn;const We={TOOLTIP_PLACEMENT:"tooltipplacement",DISABLED:"disabled",NO_TOOLTIP:"notooltip"};function Vl(t,e={}){return`
    <style>
      :host {
        position: relative;
        font: var(--media-font,
          var(--media-font-weight, bold)
          var(--media-font-size, 14px) /
          var(--media-text-content-height, var(--media-control-height, 24px))
          var(--media-font-family, helvetica neue, segoe ui, roboto, arial, sans-serif));
        color: var(--media-text-color, var(--media-primary-color, rgb(238 238 238)));
        background: var(--media-control-background, var(--media-secondary-color, rgb(20 20 30 / .7)));
        padding: var(--media-button-padding, var(--media-control-padding, 10px));
        justify-content: var(--media-button-justify-content, center);
        display: inline-flex;
        align-items: center;
        vertical-align: middle;
        box-sizing: border-box;
        transition: background .15s linear;
        pointer-events: auto;
        cursor: var(--media-cursor, pointer);
        -webkit-tap-highlight-color: transparent;
      }

      
      :host(:focus-visible) {
        box-shadow: var(--media-focus-box-shadow, inset 0 0 0 2px rgb(27 127 204 / .9));
        outline: 0;
      }
      
      :host(:where(:focus)) {
        box-shadow: none;
        outline: 0;
      }

      :host(:hover) {
        background: var(--media-control-hover-background, rgba(50 50 70 / .7));
      }

      slot[name="icon"] {
        display: inline-flex;
        align-items: center;
      }

      svg, img, ::slotted(svg), ::slotted(img) {
        width: var(--media-button-icon-width);
        height: var(--media-button-icon-height, var(--media-control-height, 24px));
        transform: var(--media-button-icon-transform);
        transition: var(--media-button-icon-transition);
        fill: var(--media-icon-color, var(--media-primary-color, rgb(238 238 238)));
        vertical-align: middle;
        max-width: 100%;
        max-height: 100%;
        min-width: 100%;
      }

      media-tooltip {
        
        max-width: 0;
        overflow-x: clip;
        opacity: 0;
        transition: opacity .3s, max-width 0s 9s;
      }

      :host(:hover) media-tooltip,
      :host(:focus-visible) media-tooltip {
        max-width: 100vw;
        opacity: 1;
        transition: opacity .3s;
      }

      :host([notooltip]) slot[name="tooltip"] {
        display: none;
      }
    </style>

    ${this.getSlotTemplateHTML(t,e)}

    <slot name="tooltip">
      <media-tooltip part="tooltip" aria-hidden="true">
        <template shadowrootmode="${ss.shadowRootOptions.mode}">
          ${ss.getTemplateHTML({})}
        </template>
        <slot name="tooltip-content">
          ${this.getTooltipContentHTML(t)}
        </slot>
      </media-tooltip>
    </slot>
  `}function Kl(t,e){return`
    <slot></slot>
  `}function Gl(){return""}class ee extends l.HTMLElement{constructor(){if(super(),ut(this,rs),ut(this,Se,void 0),this.preventClick=!1,this.tooltipEl=null,ut(this,Dt,e=>{this.preventClick||this.handleClick(e),setTimeout(G(this,Ze),0)}),ut(this,Ze,()=>{var e,i;(i=(e=this.tooltipEl)==null?void 0:e.updateXOffset)==null||i.call(e)}),ut(this,bt,e=>{const{key:i}=e;if(!this.keysUsed.includes(i)){this.removeEventListener("keyup",G(this,bt));return}this.preventClick||this.handleClick(e)}),ut(this,Ui,e=>{const{metaKey:i,altKey:a,key:s}=e;if(i||a||!this.keysUsed.includes(s)){this.removeEventListener("keyup",G(this,bt));return}this.addEventListener("keyup",G(this,bt),{once:!0})}),!this.shadowRoot){this.attachShadow(this.constructor.shadowRootOptions);const e=Ae(this.attributes),i=this.constructor.getTemplateHTML(e);this.shadowRoot.setHTMLUnsafe?this.shadowRoot.setHTMLUnsafe(i):this.shadowRoot.innerHTML=i}this.tooltipEl=this.shadowRoot.querySelector("media-tooltip")}static get observedAttributes(){return["disabled",We.TOOLTIP_PLACEMENT,P.MEDIA_CONTROLLER,n.MEDIA_LANG]}enable(){this.addEventListener("click",G(this,Dt)),this.addEventListener("keydown",G(this,Ui)),this.tabIndex=0}disable(){this.removeEventListener("click",G(this,Dt)),this.removeEventListener("keydown",G(this,Ui)),this.removeEventListener("keyup",G(this,bt)),this.tabIndex=-1}attributeChangedCallback(e,i,a){var s,r,o,d,c;e===P.MEDIA_CONTROLLER?(i&&((r=(s=G(this,Se))==null?void 0:s.unassociateElement)==null||r.call(s,this),Ti(this,Se,null)),a&&this.isConnected&&(Ti(this,Se,(o=this.getRootNode())==null?void 0:o.getElementById(a)),(c=(d=G(this,Se))==null?void 0:d.associateElement)==null||c.call(d,this))):e==="disabled"&&a!==i?a==null?this.enable():this.disable():e===We.TOOLTIP_PLACEMENT&&this.tooltipEl&&a!==i?this.tooltipEl.placement=a:e===n.MEDIA_LANG&&(this.shadowRoot.querySelector('slot[name="tooltip-content"]').innerHTML=this.constructor.getTooltipContentHTML()),G(this,Ze).call(this)}connectedCallback(){var e,i,a;const{style:s}=Q(this.shadowRoot,":host");s.setProperty("display",`var(--media-control-display, var(--${this.localName}-display, inline-flex))`),this.hasAttribute("disabled")?this.disable():this.enable(),this.setAttribute("role","button");const r=this.getAttribute(P.MEDIA_CONTROLLER);r&&(Ti(this,Se,(e=this.getRootNode())==null?void 0:e.getElementById(r)),(a=(i=G(this,Se))==null?void 0:i.associateElement)==null||a.call(i,this)),l.customElements.whenDefined("media-tooltip").then(()=>Bl(this,rs,Hn).call(this))}disconnectedCallback(){var e,i;this.disable(),(i=(e=G(this,Se))==null?void 0:e.unassociateElement)==null||i.call(e,this),Ti(this,Se,null),this.removeEventListener("mouseenter",G(this,Ze)),this.removeEventListener("focus",G(this,Ze)),this.removeEventListener("click",G(this,Dt))}get keysUsed(){return["Enter"," "]}get tooltipPlacement(){return B(this,We.TOOLTIP_PLACEMENT)}set tooltipPlacement(e){F(this,We.TOOLTIP_PLACEMENT,e)}get mediaController(){return B(this,P.MEDIA_CONTROLLER)}set mediaController(e){F(this,P.MEDIA_CONTROLLER,e)}get disabled(){return M(this,We.DISABLED)}set disabled(e){L(this,We.DISABLED,e)}get noTooltip(){return M(this,We.NO_TOOLTIP)}set noTooltip(e){L(this,We.NO_TOOLTIP,e)}handleClick(e){}}Se=new WeakMap;Dt=new WeakMap;Ze=new WeakMap;bt=new WeakMap;Ui=new WeakMap;rs=new WeakSet;Hn=function(){this.addEventListener("mouseenter",G(this,Ze)),this.addEventListener("focus",G(this,Ze)),this.addEventListener("click",G(this,Dt));const t=this.tooltipPlacement;t&&this.tooltipEl&&(this.tooltipEl.placement=t)};ee.shadowRootOptions={mode:"open"};ee.getTemplateHTML=Vl;ee.getSlotTemplateHTML=Kl;ee.getTooltipContentHTML=Gl;l.customElements.get("media-chrome-button")||l.customElements.define("media-chrome-button",ee);var ql=ee;const Nr=`<svg aria-hidden="true" viewBox="0 0 26 24">
  <path d="M22.13 3H3.87a.87.87 0 0 0-.87.87v13.26a.87.87 0 0 0 .87.87h3.4L9 16H5V5h16v11h-4l1.72 2h3.4a.87.87 0 0 0 .87-.87V3.87a.87.87 0 0 0-.86-.87Zm-8.75 11.44a.5.5 0 0 0-.76 0l-4.91 5.73a.5.5 0 0 0 .38.83h9.82a.501.501 0 0 0 .38-.83l-4.91-5.73Z"/>
</svg>
`;function Yl(t){return`
    <style>
      :host([${n.MEDIA_IS_AIRPLAYING}]) slot[name=icon] slot:not([name=exit]) {
        display: none !important;
      }

      
      :host(:not([${n.MEDIA_IS_AIRPLAYING}])) slot[name=icon] slot:not([name=enter]) {
        display: none !important;
      }

      :host([${n.MEDIA_IS_AIRPLAYING}]) slot[name=tooltip-enter],
      :host(:not([${n.MEDIA_IS_AIRPLAYING}])) slot[name=tooltip-exit] {
        display: none;
      }
    </style>

    <slot name="icon">
      <slot name="enter">${Nr}</slot>
      <slot name="exit">${Nr}</slot>
    </slot>
  `}function Ql(){return`
    <slot name="tooltip-enter">${f("start airplay")}</slot>
    <slot name="tooltip-exit">${f("stop airplay")}</slot>
  `}const $r=t=>{const e=t.mediaIsAirplaying?f("stop airplay"):f("start airplay");t.setAttribute("aria-label",e)};class ya extends ee{static get observedAttributes(){return[...super.observedAttributes,n.MEDIA_IS_AIRPLAYING,n.MEDIA_AIRPLAY_UNAVAILABLE]}connectedCallback(){super.connectedCallback(),$r(this)}attributeChangedCallback(e,i,a){super.attributeChangedCallback(e,i,a),e===n.MEDIA_IS_AIRPLAYING&&$r(this)}get mediaIsAirplaying(){return M(this,n.MEDIA_IS_AIRPLAYING)}set mediaIsAirplaying(e){L(this,n.MEDIA_IS_AIRPLAYING,e)}get mediaAirplayUnavailable(){return B(this,n.MEDIA_AIRPLAY_UNAVAILABLE)}set mediaAirplayUnavailable(e){F(this,n.MEDIA_AIRPLAY_UNAVAILABLE,e)}handleClick(){const e=new l.CustomEvent(p.MEDIA_AIRPLAY_REQUEST,{composed:!0,bubbles:!0});this.dispatchEvent(e)}}ya.getSlotTemplateHTML=Yl;ya.getTooltipContentHTML=Ql;l.customElements.get("media-airplay-button")||l.customElements.define("media-airplay-button",ya);var zl=ya;const Zl=`<svg aria-hidden="true" viewBox="0 0 26 24">
  <path d="M22.83 5.68a2.58 2.58 0 0 0-2.3-2.5c-3.62-.24-11.44-.24-15.06 0a2.58 2.58 0 0 0-2.3 2.5c-.23 4.21-.23 8.43 0 12.64a2.58 2.58 0 0 0 2.3 2.5c3.62.24 11.44.24 15.06 0a2.58 2.58 0 0 0 2.3-2.5c.23-4.21.23-8.43 0-12.64Zm-11.39 9.45a3.07 3.07 0 0 1-1.91.57 3.06 3.06 0 0 1-2.34-1 3.75 3.75 0 0 1-.92-2.67 3.92 3.92 0 0 1 .92-2.77 3.18 3.18 0 0 1 2.43-1 2.94 2.94 0 0 1 2.13.78c.364.359.62.813.74 1.31l-1.43.35a1.49 1.49 0 0 0-1.51-1.17 1.61 1.61 0 0 0-1.29.58 2.79 2.79 0 0 0-.5 1.89 3 3 0 0 0 .49 1.93 1.61 1.61 0 0 0 1.27.58 1.48 1.48 0 0 0 1-.37 2.1 2.1 0 0 0 .59-1.14l1.4.44a3.23 3.23 0 0 1-1.07 1.69Zm7.22 0a3.07 3.07 0 0 1-1.91.57 3.06 3.06 0 0 1-2.34-1 3.75 3.75 0 0 1-.92-2.67 3.88 3.88 0 0 1 .93-2.77 3.14 3.14 0 0 1 2.42-1 3 3 0 0 1 2.16.82 2.8 2.8 0 0 1 .73 1.31l-1.43.35a1.49 1.49 0 0 0-1.51-1.21 1.61 1.61 0 0 0-1.29.58A2.79 2.79 0 0 0 15 12a3 3 0 0 0 .49 1.93 1.61 1.61 0 0 0 1.27.58 1.44 1.44 0 0 0 1-.37 2.1 2.1 0 0 0 .6-1.15l1.4.44a3.17 3.17 0 0 1-1.1 1.7Z"/>
</svg>`,Xl=`<svg aria-hidden="true" viewBox="0 0 26 24">
  <path d="M17.73 14.09a1.4 1.4 0 0 1-1 .37 1.579 1.579 0 0 1-1.27-.58A3 3 0 0 1 15 12a2.8 2.8 0 0 1 .5-1.85 1.63 1.63 0 0 1 1.29-.57 1.47 1.47 0 0 1 1.51 1.2l1.43-.34A2.89 2.89 0 0 0 19 9.07a3 3 0 0 0-2.14-.78 3.14 3.14 0 0 0-2.42 1 3.91 3.91 0 0 0-.93 2.78 3.74 3.74 0 0 0 .92 2.66 3.07 3.07 0 0 0 2.34 1 3.07 3.07 0 0 0 1.91-.57 3.17 3.17 0 0 0 1.07-1.74l-1.4-.45c-.083.43-.3.822-.62 1.12Zm-7.22 0a1.43 1.43 0 0 1-1 .37 1.58 1.58 0 0 1-1.27-.58A3 3 0 0 1 7.76 12a2.8 2.8 0 0 1 .5-1.85 1.63 1.63 0 0 1 1.29-.57 1.47 1.47 0 0 1 1.51 1.2l1.43-.34a2.81 2.81 0 0 0-.74-1.32 2.94 2.94 0 0 0-2.13-.78 3.18 3.18 0 0 0-2.43 1 4 4 0 0 0-.92 2.78 3.74 3.74 0 0 0 .92 2.66 3.07 3.07 0 0 0 2.34 1 3.07 3.07 0 0 0 1.91-.57 3.23 3.23 0 0 0 1.07-1.74l-1.4-.45a2.06 2.06 0 0 1-.6 1.07Zm12.32-8.41a2.59 2.59 0 0 0-2.3-2.51C18.72 3.05 15.86 3 13 3c-2.86 0-5.72.05-7.53.17a2.59 2.59 0 0 0-2.3 2.51c-.23 4.207-.23 8.423 0 12.63a2.57 2.57 0 0 0 2.3 2.5c1.81.13 4.67.19 7.53.19 2.86 0 5.72-.06 7.53-.19a2.57 2.57 0 0 0 2.3-2.5c.23-4.207.23-8.423 0-12.63Zm-1.49 12.53a1.11 1.11 0 0 1-.91 1.11c-1.67.11-4.45.18-7.43.18-2.98 0-5.76-.07-7.43-.18a1.11 1.11 0 0 1-.91-1.11c-.21-4.14-.21-8.29 0-12.43a1.11 1.11 0 0 1 .91-1.11C7.24 4.56 10 4.49 13 4.49s5.76.07 7.43.18a1.11 1.11 0 0 1 .91 1.11c.21 4.14.21 8.29 0 12.43Z"/>
</svg>`;function Jl(t){return`
    <style>
      :host([aria-checked="true"]) slot[name=off] {
        display: none !important;
      }

      
      :host(:not([aria-checked="true"])) slot[name=on] {
        display: none !important;
      }

      :host([aria-checked="true"]) slot[name=tooltip-enable],
      :host(:not([aria-checked="true"])) slot[name=tooltip-disable] {
        display: none;
      }
    </style>

    <slot name="icon">
      <slot name="on">${Zl}</slot>
      <slot name="off">${Xl}</slot>
    </slot>
  `}function jl(){return`
    <slot name="tooltip-enable">${f("Enable captions")}</slot>
    <slot name="tooltip-disable">${f("Disable captions")}</slot>
  `}const Hr=t=>{t.setAttribute("aria-checked",dl(t).toString())};class Sa extends ee{static get observedAttributes(){return[...super.observedAttributes,n.MEDIA_SUBTITLES_LIST,n.MEDIA_SUBTITLES_SHOWING]}connectedCallback(){super.connectedCallback(),this.setAttribute("role","button"),this.setAttribute("aria-label",f("closed captions")),Hr(this)}attributeChangedCallback(e,i,a){super.attributeChangedCallback(e,i,a),e===n.MEDIA_SUBTITLES_SHOWING&&Hr(this)}get mediaSubtitlesList(){return Fr(this,n.MEDIA_SUBTITLES_LIST)}set mediaSubtitlesList(e){Wr(this,n.MEDIA_SUBTITLES_LIST,e)}get mediaSubtitlesShowing(){return Fr(this,n.MEDIA_SUBTITLES_SHOWING)}set mediaSubtitlesShowing(e){Wr(this,n.MEDIA_SUBTITLES_SHOWING,e)}handleClick(){this.dispatchEvent(new l.CustomEvent(p.MEDIA_TOGGLE_SUBTITLES_REQUEST,{composed:!0,bubbles:!0}))}}Sa.getSlotTemplateHTML=Jl;Sa.getTooltipContentHTML=jl;const Fr=(t,e)=>{const i=t.getAttribute(e);return i?Ln(i):[]},Wr=(t,e,i)=>{if(!i?.length){t.removeAttribute(e);return}const a=ja(i);t.getAttribute(e)!==a&&t.setAttribute(e,a)};l.customElements.get("media-captions-button")||l.customElements.define("media-captions-button",Sa);var ed=Sa;const td='<svg aria-hidden="true" viewBox="0 0 24 24"><g><path class="cast_caf_icon_arch0" d="M1,18 L1,21 L4,21 C4,19.3 2.66,18 1,18 L1,18 Z"/><path class="cast_caf_icon_arch1" d="M1,14 L1,16 C3.76,16 6,18.2 6,21 L8,21 C8,17.13 4.87,14 1,14 L1,14 Z"/><path class="cast_caf_icon_arch2" d="M1,10 L1,12 C5.97,12 10,16.0 10,21 L12,21 C12,14.92 7.07,10 1,10 L1,10 Z"/><path class="cast_caf_icon_box" d="M21,3 L3,3 C1.9,3 1,3.9 1,5 L1,8 L3,8 L3,5 L21,5 L21,19 L14,19 L14,21 L21,21 C22.1,21 23,20.1 23,19 L23,5 C23,3.9 22.1,3 21,3 L21,3 Z"/></g></svg>',id='<svg aria-hidden="true" viewBox="0 0 24 24"><g><path class="cast_caf_icon_arch0" d="M1,18 L1,21 L4,21 C4,19.3 2.66,18 1,18 L1,18 Z"/><path class="cast_caf_icon_arch1" d="M1,14 L1,16 C3.76,16 6,18.2 6,21 L8,21 C8,17.13 4.87,14 1,14 L1,14 Z"/><path class="cast_caf_icon_arch2" d="M1,10 L1,12 C5.97,12 10,16.0 10,21 L12,21 C12,14.92 7.07,10 1,10 L1,10 Z"/><path class="cast_caf_icon_box" d="M21,3 L3,3 C1.9,3 1,3.9 1,5 L1,8 L3,8 L3,5 L21,5 L21,19 L14,19 L14,21 L21,21 C22.1,21 23,20.1 23,19 L23,5 C23,3.9 22.1,3 21,3 L21,3 Z"/><path class="cast_caf_icon_boxfill" d="M5,7 L5,8.63 C8,8.6 13.37,14 13.37,17 L19,17 L19,7 Z"/></g></svg>';function ad(t){return`
    <style>
      :host([${n.MEDIA_IS_CASTING}]) slot[name=icon] slot:not([name=exit]) {
        display: none !important;
      }

      
      :host(:not([${n.MEDIA_IS_CASTING}])) slot[name=icon] slot:not([name=enter]) {
        display: none !important;
      }

      :host([${n.MEDIA_IS_CASTING}]) slot[name=tooltip-enter],
      :host(:not([${n.MEDIA_IS_CASTING}])) slot[name=tooltip-exit] {
        display: none;
      }
    </style>

    <slot name="icon">
      <slot name="enter">${td}</slot>
      <slot name="exit">${id}</slot>
    </slot>
  `}function sd(){return`
    <slot name="tooltip-enter">${f("Start casting")}</slot>
    <slot name="tooltip-exit">${f("Stop casting")}</slot>
  `}const Br=t=>{const e=t.mediaIsCasting?f("stop casting"):f("start casting");t.setAttribute("aria-label",e)};class ka extends ee{static get observedAttributes(){return[...super.observedAttributes,n.MEDIA_IS_CASTING,n.MEDIA_CAST_UNAVAILABLE]}connectedCallback(){super.connectedCallback(),Br(this)}attributeChangedCallback(e,i,a){super.attributeChangedCallback(e,i,a),e===n.MEDIA_IS_CASTING&&Br(this)}get mediaIsCasting(){return M(this,n.MEDIA_IS_CASTING)}set mediaIsCasting(e){L(this,n.MEDIA_IS_CASTING,e)}get mediaCastUnavailable(){return B(this,n.MEDIA_CAST_UNAVAILABLE)}set mediaCastUnavailable(e){F(this,n.MEDIA_CAST_UNAVAILABLE,e)}handleClick(){const e=this.mediaIsCasting?p.MEDIA_EXIT_CAST_REQUEST:p.MEDIA_ENTER_CAST_REQUEST;this.dispatchEvent(new l.CustomEvent(e,{composed:!0,bubbles:!0}))}}ka.getSlotTemplateHTML=ad;ka.getTooltipContentHTML=sd;l.customElements.get("media-cast-button")||l.customElements.define("media-cast-button",ka);var rd=ka,Os=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},st=(t,e,i)=>(Os(t,e,"read from private field"),e.get(t)),xe=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},xs=(t,e,i,a)=>(Os(t,e,"write to private field"),e.set(t,i),i),Je=(t,e,i)=>(Os(t,e,"access private method"),i),da,ui,rt,Ni,ns,os,Fn,ls,Wn,ds,Bn,cs,Vn,us,Kn;function nd(t){return`
    <style>
      :host {
        font: var(--media-font,
          var(--media-font-weight, normal)
          var(--media-font-size, 14px) /
          var(--media-text-content-height, var(--media-control-height, 24px))
          var(--media-font-family, helvetica neue, segoe ui, roboto, arial, sans-serif));
        color: var(--media-text-color, var(--media-primary-color, rgb(238 238 238)));
        display: var(--media-dialog-display, inline-flex);
        justify-content: center;
        align-items: center;
        
        transition-behavior: allow-discrete;
        visibility: hidden;
        opacity: 0;
        transform: translateY(2px) scale(.99);
        pointer-events: none;
      }

      :host([open]) {
        transition: display .2s, visibility 0s, opacity .2s ease-out, transform .15s ease-out;
        visibility: visible;
        opacity: 1;
        transform: translateY(0) scale(1);
        pointer-events: auto;
      }

      #content {
        display: flex;
        position: relative;
        box-sizing: border-box;
        width: min(320px, 100%);
        word-wrap: break-word;
        max-height: 100%;
        overflow: auto;
        text-align: center;
        line-height: 1.4;
      }
    </style>
    ${this.getSlotTemplateHTML(t)}
  `}function od(t){return`
    <slot id="content"></slot>
  `}const Wt={OPEN:"open",ANCHOR:"anchor"};class nt extends l.HTMLElement{constructor(){super(),xe(this,Ni),xe(this,os),xe(this,ls),xe(this,ds),xe(this,cs),xe(this,us),xe(this,da,!1),xe(this,ui,null),xe(this,rt,null)}static get observedAttributes(){return[Wt.OPEN,Wt.ANCHOR]}get open(){return M(this,Wt.OPEN)}set open(e){L(this,Wt.OPEN,e)}handleEvent(e){switch(e.type){case"invoke":Je(this,ds,Bn).call(this,e);break;case"focusout":Je(this,cs,Vn).call(this,e);break;case"keydown":Je(this,us,Kn).call(this,e);break}}connectedCallback(){Je(this,Ni,ns).call(this),this.role||(this.role="dialog"),this.addEventListener("invoke",this),this.addEventListener("focusout",this),this.addEventListener("keydown",this)}disconnectedCallback(){this.removeEventListener("invoke",this),this.removeEventListener("focusout",this),this.removeEventListener("keydown",this)}attributeChangedCallback(e,i,a){Je(this,Ni,ns).call(this),e===Wt.OPEN&&a!==i&&(this.open?Je(this,os,Fn).call(this):Je(this,ls,Wn).call(this))}focus(){xs(this,ui,_n());const e=!this.dispatchEvent(new Event("focus",{composed:!0,cancelable:!0})),i=!this.dispatchEvent(new Event("focusin",{composed:!0,bubbles:!0,cancelable:!0}));if(e||i)return;const a=this.querySelector('[autofocus], [tabindex]:not([tabindex="-1"]), [role="menu"]');a?.focus()}get keysUsed(){return["Escape","Tab"]}}da=new WeakMap;ui=new WeakMap;rt=new WeakMap;Ni=new WeakSet;ns=function(){if(!st(this,da)&&(xs(this,da,!0),!this.shadowRoot)){this.attachShadow(this.constructor.shadowRootOptions);const t=Ae(this.attributes);this.shadowRoot.innerHTML=this.constructor.getTemplateHTML(t),queueMicrotask(()=>{const{style:e}=Q(this.shadowRoot,":host");e.setProperty("transition","display .15s, visibility .15s, opacity .15s ease-in, transform .15s ease-in")})}};os=new WeakSet;Fn=function(){var t;(t=st(this,rt))==null||t.setAttribute("aria-expanded","true"),this.dispatchEvent(new Event("open",{composed:!0,bubbles:!0})),this.addEventListener("transitionend",()=>this.focus(),{once:!0})};ls=new WeakSet;Wn=function(){var t;(t=st(this,rt))==null||t.setAttribute("aria-expanded","false"),this.dispatchEvent(new Event("close",{composed:!0,bubbles:!0}))};ds=new WeakSet;Bn=function(t){xs(this,rt,t.relatedTarget),Nt(this,t.relatedTarget)||(this.open=!this.open)};cs=new WeakSet;Vn=function(t){var e;Nt(this,t.relatedTarget)||((e=st(this,ui))==null||e.focus(),st(this,rt)&&st(this,rt)!==t.relatedTarget&&this.open&&(this.open=!1))};us=new WeakSet;Kn=function(t){var e,i,a,s,r;const{key:o,ctrlKey:d,altKey:c,metaKey:y}=t;d||c||y||this.keysUsed.includes(o)&&(t.preventDefault(),t.stopPropagation(),o==="Tab"?(t.shiftKey?(i=(e=this.previousElementSibling)==null?void 0:e.focus)==null||i.call(e):(s=(a=this.nextElementSibling)==null?void 0:a.focus)==null||s.call(a),this.blur()):o==="Escape"&&((r=st(this,ui))==null||r.focus(),this.open=!1))};nt.shadowRootOptions={mode:"open"};nt.getTemplateHTML=nd;nt.getSlotTemplateHTML=od;l.customElements.get("media-chrome-dialog")||l.customElements.define("media-chrome-dialog",nt);var ld=nt,Us=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},$=(t,e,i)=>(Us(t,e,"read from private field"),i?i.call(t):e.get(t)),te=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},Ge=(t,e,i,a)=>(Us(t,e,"write to private field"),e.set(t,i),i),fe=(t,e,i)=>(Us(t,e,"access private method"),i),ke,Ma,$i,Hi,_e,ca,Fi,Wi,Bi,Ns,Gn,Vi,hs,Ki,ms,ua,$s,ps,qn,Es,Yn,vs,Qn,fs,zn;function dd(t){return`
    <style>
      :host {
        --_focus-box-shadow: var(--media-focus-box-shadow, inset 0 0 0 2px rgb(27 127 204 / .9));
        --_media-range-padding: var(--media-range-padding, var(--media-control-padding, 10px));

        box-shadow: var(--_focus-visible-box-shadow, none);
        background: var(--media-control-background, var(--media-secondary-color, rgb(20 20 30 / .7)));
        height: calc(var(--media-control-height, 24px) + 2 * var(--_media-range-padding));
        display: inline-flex;
        align-items: center;
        
        vertical-align: middle;
        box-sizing: border-box;
        position: relative;
        width: 100px;
        transition: background .15s linear;
        cursor: var(--media-cursor, pointer);
        pointer-events: auto;
        touch-action: none; 
      }

      
      input[type=range]:focus {
        outline: 0;
      }
      input[type=range]:focus::-webkit-slider-runnable-track {
        outline: 0;
      }

      :host(:hover) {
        background: var(--media-control-hover-background, rgb(50 50 70 / .7));
      }

      #leftgap {
        padding-left: var(--media-range-padding-left, var(--_media-range-padding));
      }

      #rightgap {
        padding-right: var(--media-range-padding-right, var(--_media-range-padding));
      }

      #startpoint,
      #endpoint {
        position: absolute;
      }

      #endpoint {
        right: 0;
      }

      #container {
        
        width: var(--media-range-track-width, 100%);
        transform: translate(var(--media-range-track-translate-x, 0px), var(--media-range-track-translate-y, 0px));
        position: relative;
        height: 100%;
        display: flex;
        align-items: center;
        min-width: 40px;
      }

      #range {
        
        display: var(--media-time-range-hover-display, block);
        bottom: var(--media-time-range-hover-bottom, 0);
        height: var(--media-time-range-hover-height, max(100% , 25px));
        width: 100%;
        position: absolute;
        cursor: var(--media-cursor, pointer);

        -webkit-appearance: none; 
        -webkit-tap-highlight-color: transparent;
        background: transparent; 
        margin: 0;
        z-index: 1;
      }

      @media (hover: hover) {
        #range {
          bottom: var(--media-time-range-hover-bottom, 0);
          height: var(--media-time-range-hover-height, max(100%, 20px));
        }
      }

      
      
      #range::-webkit-slider-thumb {
        -webkit-appearance: none;
        background: transparent;
        width: .1px;
        height: .1px;
      }

      
      #range::-moz-range-thumb {
        background: transparent;
        border: transparent;
        width: .1px;
        height: .1px;
      }

      #appearance {
        height: var(--media-range-track-height, 4px);
        display: flex;
        flex-direction: column;
        justify-content: center;
        width: 100%;
        position: absolute;
        
        will-change: transform;
      }

      #track {
        background: var(--media-range-track-background, rgb(255 255 255 / .2));
        border-radius: var(--media-range-track-border-radius, 1px);
        border: var(--media-range-track-border, none);
        outline: var(--media-range-track-outline);
        outline-offset: var(--media-range-track-outline-offset);
        backdrop-filter: var(--media-range-track-backdrop-filter);
        -webkit-backdrop-filter: var(--media-range-track-backdrop-filter);
        box-shadow: var(--media-range-track-box-shadow, none);
        position: absolute;
        width: 100%;
        height: 100%;
        overflow: hidden;
      }

      #progress,
      #pointer {
        position: absolute;
        height: 100%;
        will-change: width;
      }

      #progress {
        background: var(--media-range-bar-color, var(--media-primary-color, rgb(238 238 238)));
        transition: var(--media-range-track-transition);
      }

      #pointer {
        background: var(--media-range-track-pointer-background);
        border-right: var(--media-range-track-pointer-border-right);
        transition: visibility .25s, opacity .25s;
        visibility: hidden;
        opacity: 0;
      }

      @media (hover: hover) {
        :host(:hover) #pointer {
          transition: visibility .5s, opacity .5s;
          visibility: visible;
          opacity: 1;
        }
      }

      #thumb,
      ::slotted([slot=thumb]) {
        width: var(--media-range-thumb-width, 10px);
        height: var(--media-range-thumb-height, 10px);
        transition: var(--media-range-thumb-transition);
        transform: var(--media-range-thumb-transform, none);
        opacity: var(--media-range-thumb-opacity, 1);
        translate: -50%;
        position: absolute;
        left: 0;
        cursor: var(--media-cursor, pointer);
      }

      #thumb {
        border-radius: var(--media-range-thumb-border-radius, 10px);
        background: var(--media-range-thumb-background, var(--media-primary-color, rgb(238 238 238)));
        box-shadow: var(--media-range-thumb-box-shadow, 1px 1px 1px transparent);
        border: var(--media-range-thumb-border, none);
      }

      :host([disabled]) #thumb {
        background-color: #777;
      }

      .segments #appearance {
        height: var(--media-range-segment-hover-height, 7px);
      }

      #track {
        clip-path: url(#segments-clipping);
      }

      #segments {
        --segments-gap: var(--media-range-segments-gap, 2px);
        position: absolute;
        width: 100%;
        height: 100%;
      }

      #segments-clipping {
        transform: translateX(calc(var(--segments-gap) / 2));
      }

      #segments-clipping:empty {
        display: none;
      }

      #segments-clipping rect {
        height: var(--media-range-track-height, 4px);
        y: calc((var(--media-range-segment-hover-height, 7px) - var(--media-range-track-height, 4px)) / 2);
        transition: var(--media-range-segment-transition, transform .1s ease-in-out);
        transform: var(--media-range-segment-transform, scaleY(1));
        transform-origin: center;
      }

      /* Visible label for accessibility - positioned off-screen but technically visible (Firefox requires visible labels) */
      #range-label {
        position: absolute;
        left: -10000px;
        background: var(--media-control-background, var(--media-secondary-color, rgb(20 20 30 / .7)));
        pointer-events: none;
      }
    </style>
    <div id="leftgap"></div>
    <div id="container">
      <div id="startpoint"></div>
      <div id="endpoint"></div>
      <div id="appearance">
        <div id="track" part="track">
          <div id="pointer"></div>
          <div id="progress" part="progress"></div>
        </div>
        <slot name="thumb">
          <div id="thumb" part="thumb"></div>
        </slot>
        <svg id="segments" aria-hidden="true"><clipPath id="segments-clipping"></clipPath></svg>
      </div>
        <input id="range" type="range" min="0" max="1" step="any" value="0">
        <label for="range" id="range-label"></label>

      ${this.getContainerTemplateHTML(t)}
    </div>
    <div id="rightgap"></div>
  `}function cd(t){return""}class ot extends l.HTMLElement{constructor(){if(super(),te(this,Ns),te(this,Vi),te(this,Ki),te(this,ua),te(this,ps),te(this,Es),te(this,vs),te(this,fs),te(this,ke,void 0),te(this,Ma,void 0),te(this,$i,void 0),te(this,Hi,void 0),te(this,_e,{}),te(this,ca,[]),te(this,Fi,()=>{if(this.range.matches(":focus-visible")){const{style:e}=Q(this.shadowRoot,":host");e.setProperty("--_focus-visible-box-shadow","var(--_focus-box-shadow)")}}),te(this,Wi,()=>{const{style:e}=Q(this.shadowRoot,":host");e.removeProperty("--_focus-visible-box-shadow")}),te(this,Bi,()=>{const e=this.shadowRoot.querySelector("#segments-clipping");e&&e.parentNode.append(e)}),!this.shadowRoot){this.attachShadow(this.constructor.shadowRootOptions);const e=Ae(this.attributes),i=this.constructor.getTemplateHTML(e);this.shadowRoot.setHTMLUnsafe?this.shadowRoot.setHTMLUnsafe(i):this.shadowRoot.innerHTML=i}this.container=this.shadowRoot.querySelector("#container"),Ge(this,$i,this.shadowRoot.querySelector("#startpoint")),Ge(this,Hi,this.shadowRoot.querySelector("#endpoint")),this.range=this.shadowRoot.querySelector("#range"),this.appearance=this.shadowRoot.querySelector("#appearance")}static get observedAttributes(){return["disabled","aria-disabled",P.MEDIA_CONTROLLER]}attributeChangedCallback(e,i,a){var s,r,o,d,c;e===P.MEDIA_CONTROLLER?(i&&((r=(s=$(this,ke))==null?void 0:s.unassociateElement)==null||r.call(s,this),Ge(this,ke,null)),a&&this.isConnected&&(Ge(this,ke,(o=this.getRootNode())==null?void 0:o.getElementById(a)),(c=(d=$(this,ke))==null?void 0:d.associateElement)==null||c.call(d,this))):(e==="disabled"||e==="aria-disabled"&&i!==a)&&(a==null?(this.range.removeAttribute(e),fe(this,Vi,hs).call(this)):(this.range.setAttribute(e,a),fe(this,Ki,ms).call(this)))}connectedCallback(){var e,i,a;const{style:s}=Q(this.shadowRoot,":host");s.setProperty("display",`var(--media-control-display, var(--${this.localName}-display, inline-flex))`),$(this,_e).pointer=Q(this.shadowRoot,"#pointer"),$(this,_e).progress=Q(this.shadowRoot,"#progress"),$(this,_e).thumb=Q(this.shadowRoot,'#thumb, ::slotted([slot="thumb"])'),$(this,_e).activeSegment=Q(this.shadowRoot,"#segments-clipping rect:nth-child(0)");const r=this.getAttribute(P.MEDIA_CONTROLLER);r&&(Ge(this,ke,(e=this.getRootNode())==null?void 0:e.getElementById(r)),(a=(i=$(this,ke))==null?void 0:i.associateElement)==null||a.call(i,this)),this.updateBar(),this.shadowRoot.addEventListener("focusin",$(this,Fi)),this.shadowRoot.addEventListener("focusout",$(this,Wi)),fe(this,Vi,hs).call(this),pn(this.container,$(this,Bi))}disconnectedCallback(){var e,i;fe(this,Ki,ms).call(this),(i=(e=$(this,ke))==null?void 0:e.unassociateElement)==null||i.call(e,this),Ge(this,ke,null),this.shadowRoot.removeEventListener("focusin",$(this,Fi)),this.shadowRoot.removeEventListener("focusout",$(this,Wi)),En(this.container,$(this,Bi))}updatePointerBar(e){var i;(i=$(this,_e).pointer)==null||i.style.setProperty("width",`${this.getPointerRatio(e)*100}%`)}updateBar(){var e,i;const a=this.range.valueAsNumber*100;(e=$(this,_e).progress)==null||e.style.setProperty("width",`${a}%`),(i=$(this,_e).thumb)==null||i.style.setProperty("left",`${a}%`)}updateSegments(e){const i=this.shadowRoot.querySelector("#segments-clipping");if(i.textContent="",this.container.classList.toggle("segments",!!e?.length),!e?.length)return;const a=[...new Set([+this.range.min,...e.flatMap(r=>[r.start,r.end]),+this.range.max])];Ge(this,ca,[...a]);const s=a.pop();for(const[r,o]of a.entries()){const[d,c]=[r===0,r===a.length-1],y=d?"calc(var(--segments-gap) / -1)":`${o*100}%`,g=`calc(${((c?s:a[r+1])-o)*100}%${d||c?"":" - var(--segments-gap)"})`,E=re.createElementNS("http://www.w3.org/2000/svg","rect"),m=bn(this.shadowRoot,`#segments-clipping rect:nth-child(${r+1})`);m.style.setProperty("x",y),m.style.setProperty("width",g),i.append(E)}}getPointerRatio(e){return Qo(e.clientX,e.clientY,$(this,$i).getBoundingClientRect(),$(this,Hi).getBoundingClientRect())}get dragging(){return this.hasAttribute("dragging")}handleEvent(e){switch(e.type){case"pointermove":fe(this,fs,zn).call(this,e);break;case"input":this.updateBar();break;case"pointerenter":fe(this,ps,qn).call(this,e);break;case"pointerdown":fe(this,ua,$s).call(this,e);break;case"pointerup":fe(this,Es,Yn).call(this);break;case"pointerleave":fe(this,vs,Qn).call(this);break}}get keysUsed(){return["ArrowUp","ArrowRight","ArrowDown","ArrowLeft"]}}ke=new WeakMap;Ma=new WeakMap;$i=new WeakMap;Hi=new WeakMap;_e=new WeakMap;ca=new WeakMap;Fi=new WeakMap;Wi=new WeakMap;Bi=new WeakMap;Ns=new WeakSet;Gn=function(t){const e=$(this,_e).activeSegment;if(!e)return;const i=this.getPointerRatio(t),s=`#segments-clipping rect:nth-child(${$(this,ca).findIndex((r,o,d)=>{const c=d[o+1];return c!=null&&i>=r&&i<=c})+1})`;(e.selectorText!=s||!e.style.transform)&&(e.selectorText=s,e.style.setProperty("transform","var(--media-range-segment-hover-transform, scaleY(2))"))};Vi=new WeakSet;hs=function(){this.hasAttribute("disabled")||!this.isConnected||(this.addEventListener("input",this),this.addEventListener("pointerdown",this),this.addEventListener("pointerenter",this))};Ki=new WeakSet;ms=function(){var t,e;this.removeEventListener("input",this),this.removeEventListener("pointerdown",this),this.removeEventListener("pointerenter",this),this.removeEventListener("pointerleave",this),(t=l.window)==null||t.removeEventListener("pointerup",this),(e=l.window)==null||e.removeEventListener("pointermove",this)};ua=new WeakSet;$s=function(t){var e;Ge(this,Ma,t.composedPath().includes(this.range)),(e=l.window)==null||e.addEventListener("pointerup",this,{once:!0})};ps=new WeakSet;qn=function(t){var e;t.pointerType!=="mouse"&&fe(this,ua,$s).call(this,t),this.addEventListener("pointerleave",this,{once:!0}),(e=l.window)==null||e.addEventListener("pointermove",this)};Es=new WeakSet;Yn=function(){var t;(t=l.window)==null||t.removeEventListener("pointerup",this),this.toggleAttribute("dragging",!1),this.range.disabled=this.hasAttribute("disabled")};vs=new WeakSet;Qn=function(){var t,e;this.removeEventListener("pointerleave",this),(t=l.window)==null||t.removeEventListener("pointermove",this),this.toggleAttribute("dragging",!1),this.range.disabled=this.hasAttribute("disabled"),(e=$(this,_e).activeSegment)==null||e.style.removeProperty("transform")};fs=new WeakSet;zn=function(t){t.pointerType==="pen"&&t.buttons===0||(this.toggleAttribute("dragging",t.buttons===1||t.pointerType!=="mouse"),this.updatePointerBar(t),fe(this,Ns,Gn).call(this,t),this.dragging&&(t.pointerType!=="mouse"||!$(this,Ma))&&(this.range.disabled=!0,this.range.valueAsNumber=this.getPointerRatio(t),this.range.dispatchEvent(new Event("input",{bubbles:!0,composed:!0}))))};ot.shadowRootOptions={mode:"open"};ot.getTemplateHTML=dd;ot.getContainerTemplateHTML=cd;l.customElements.get("media-chrome-range")||l.customElements.define("media-chrome-range",ot);var ud=ot,Zn=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},Ii=(t,e,i)=>(Zn(t,e,"read from private field"),i?i.call(t):e.get(t)),hd=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},yi=(t,e,i,a)=>(Zn(t,e,"write to private field"),e.set(t,i),i),Me;function md(t){return`
    <style>
      :host {
        
        box-sizing: border-box;
        display: var(--media-control-display, var(--media-control-bar-display, inline-flex));
        color: var(--media-text-color, var(--media-primary-color, rgb(238 238 238)));
        --media-loading-indicator-icon-height: 44px;
      }

      ::slotted(media-time-range),
      ::slotted(media-volume-range) {
        min-height: 100%;
      }

      ::slotted(media-time-range),
      ::slotted(media-clip-selector) {
        flex-grow: 1;
      }

      ::slotted([role="menu"]) {
        position: absolute;
      }
    </style>

    <slot></slot>
  `}let La=class extends l.HTMLElement{constructor(){if(super(),hd(this,Me,void 0),!this.shadowRoot){this.attachShadow(this.constructor.shadowRootOptions);const e=Ae(this.attributes);this.shadowRoot.innerHTML=this.constructor.getTemplateHTML(e)}}static get observedAttributes(){return[P.MEDIA_CONTROLLER]}attributeChangedCallback(e,i,a){var s,r,o,d,c;e===P.MEDIA_CONTROLLER&&(i&&((r=(s=Ii(this,Me))==null?void 0:s.unassociateElement)==null||r.call(s,this),yi(this,Me,null)),a&&this.isConnected&&(yi(this,Me,(o=this.getRootNode())==null?void 0:o.getElementById(a)),(c=(d=Ii(this,Me))==null?void 0:d.associateElement)==null||c.call(d,this)))}connectedCallback(){var e,i,a;const s=this.getAttribute(P.MEDIA_CONTROLLER);s&&(yi(this,Me,(e=this.getRootNode())==null?void 0:e.getElementById(s)),(a=(i=Ii(this,Me))==null?void 0:i.associateElement)==null||a.call(i,this))}disconnectedCallback(){var e,i;(i=(e=Ii(this,Me))==null?void 0:e.unassociateElement)==null||i.call(e,this),yi(this,Me,null)}};Me=new WeakMap;La.shadowRootOptions={mode:"open"};La.getTemplateHTML=md;l.customElements.get("media-control-bar")||l.customElements.define("media-control-bar",La);var pd=La,Xn=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},Si=(t,e,i)=>(Xn(t,e,"read from private field"),i?i.call(t):e.get(t)),Ed=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},ki=(t,e,i,a)=>(Xn(t,e,"write to private field"),e.set(t,i),i),Le;function vd(t,e={}){return`
    <style>
      :host {
        font: var(--media-font,
          var(--media-font-weight, normal)
          var(--media-font-size, 14px) /
          var(--media-text-content-height, var(--media-control-height, 24px))
          var(--media-font-family, helvetica neue, segoe ui, roboto, arial, sans-serif));
        color: var(--media-text-color, var(--media-primary-color, rgb(238 238 238)));
        background: var(--media-text-background, var(--media-control-background, var(--media-secondary-color, rgb(20 20 30 / .7))));
        padding: var(--media-control-padding, 10px);
        display: inline-flex;
        justify-content: center;
        align-items: center;
        vertical-align: middle;
        box-sizing: border-box;
        text-align: center;
        pointer-events: auto;
      }

      
      :host(:focus-visible) {
        box-shadow: var(--media-focus-box-shadow, inset 0 0 0 2px rgb(27 127 204 / .9));
        outline: 0;
      }

      
      :host(:where(:focus)) {
        box-shadow: none;
        outline: 0;
      }
    </style>

    ${this.getSlotTemplateHTML(t,e)}
  `}function fd(t,e){return`
    <slot></slot>
  `}class He extends l.HTMLElement{constructor(){if(super(),Ed(this,Le,void 0),!this.shadowRoot){this.attachShadow(this.constructor.shadowRootOptions);const e=Ae(this.attributes);this.shadowRoot.innerHTML=this.constructor.getTemplateHTML(e)}}static get observedAttributes(){return[P.MEDIA_CONTROLLER]}attributeChangedCallback(e,i,a){var s,r,o,d,c;e===P.MEDIA_CONTROLLER&&(i&&((r=(s=Si(this,Le))==null?void 0:s.unassociateElement)==null||r.call(s,this),ki(this,Le,null)),a&&this.isConnected&&(ki(this,Le,(o=this.getRootNode())==null?void 0:o.getElementById(a)),(c=(d=Si(this,Le))==null?void 0:d.associateElement)==null||c.call(d,this)))}connectedCallback(){var e,i,a;const{style:s}=Q(this.shadowRoot,":host");s.setProperty("display",`var(--media-control-display, var(--${this.localName}-display, inline-flex))`);const r=this.getAttribute(P.MEDIA_CONTROLLER);r&&(ki(this,Le,(e=this.getRootNode())==null?void 0:e.getElementById(r)),(a=(i=Si(this,Le))==null?void 0:i.associateElement)==null||a.call(i,this))}disconnectedCallback(){var e,i;(i=(e=Si(this,Le))==null?void 0:e.unassociateElement)==null||i.call(e,this),ki(this,Le,null)}}Le=new WeakMap;He.shadowRootOptions={mode:"open"};He.getTemplateHTML=vd;He.getSlotTemplateHTML=fd;l.customElements.get("media-text-display")||l.customElements.define("media-text-display",He);var _d=He,Jn=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},Vr=(t,e,i)=>(Jn(t,e,"read from private field"),i?i.call(t):e.get(t)),gd=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},bd=(t,e,i,a)=>(Jn(t,e,"write to private field"),e.set(t,i),i),Zt;function Ad(t,e){return`
    <slot>${Xe(e.mediaDuration)}</slot>
  `}class Hs extends He{constructor(){var e;super(),gd(this,Zt,void 0),bd(this,Zt,this.shadowRoot.querySelector("slot")),Vr(this,Zt).textContent=Xe((e=this.mediaDuration)!=null?e:0)}static get observedAttributes(){return[...super.observedAttributes,n.MEDIA_DURATION]}attributeChangedCallback(e,i,a){e===n.MEDIA_DURATION&&(Vr(this,Zt).textContent=Xe(+a)),super.attributeChangedCallback(e,i,a)}get mediaDuration(){return H(this,n.MEDIA_DURATION)}set mediaDuration(e){j(this,n.MEDIA_DURATION,e)}}Zt=new WeakMap;Hs.getSlotTemplateHTML=Ad;l.customElements.get("media-duration-display")||l.customElements.define("media-duration-display",Hs);var Td=Hs;const Id={2:f("Network Error"),3:f("Decode Error"),4:f("Source Not Supported"),5:f("Encryption Error")},yd={2:f("A network error caused the media download to fail."),3:f("A media error caused playback to be aborted. The media could be corrupt or your browser does not support this format."),4:f("An unsupported error occurred. The server or network failed, or your browser does not support this format."),5:f("The media is encrypted and there are no keys to decrypt it.")},Fs=t=>{var e,i;return t.code===1?null:{title:(e=Id[t.code])!=null?e:`Error ${t.code}`,message:(i=yd[t.code])!=null?i:t.message}};var jn=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},Sd=(t,e,i)=>(jn(t,e,"read from private field"),i?i.call(t):e.get(t)),kd=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},Md=(t,e,i,a)=>(jn(t,e,"write to private field"),e.set(t,i),i),Gi;function Ld(t){return`
    <style>
      :host {
        background: rgb(20 20 30 / .8);
      }

      #content {
        display: block;
        padding: 1.2em 1.5em;
      }

      h3,
      p {
        margin-block: 0 .3em;
      }
    </style>
    <slot name="error-${t.mediaerrorcode}" id="content">
      ${eo({code:+t.mediaerrorcode,message:t.mediaerrormessage})}
    </slot>
  `}function wd(t){return t.code&&Fs(t)!==null}function eo(t){var e;const{title:i,message:a}=(e=Fs(t))!=null?e:{};let s="";return i&&(s+=`<slot name="error-${t.code}-title"><h3>${i}</h3></slot>`),a&&(s+=`<slot name="error-${t.code}-message"><p>${a}</p></slot>`),s}const Kr=[n.MEDIA_ERROR_CODE,n.MEDIA_ERROR_MESSAGE];class wa extends nt{constructor(){super(...arguments),kd(this,Gi,null)}static get observedAttributes(){return[...super.observedAttributes,...Kr]}formatErrorMessage(e){return this.constructor.formatErrorMessage(e)}attributeChangedCallback(e,i,a){var s;if(super.attributeChangedCallback(e,i,a),!Kr.includes(e))return;const r=(s=this.mediaError)!=null?s:{code:this.mediaErrorCode,message:this.mediaErrorMessage};if(this.open=wd(r),this.open&&(this.shadowRoot.querySelector("slot").name=`error-${this.mediaErrorCode}`,this.shadowRoot.querySelector("#content").innerHTML=this.formatErrorMessage(r),!this.hasAttribute("aria-label"))){const{title:o}=Fs(r);o&&this.setAttribute("aria-label",o)}}get mediaError(){return Sd(this,Gi)}set mediaError(e){Md(this,Gi,e)}get mediaErrorCode(){return H(this,"mediaerrorcode")}set mediaErrorCode(e){j(this,"mediaerrorcode",e)}get mediaErrorMessage(){return B(this,"mediaerrormessage")}set mediaErrorMessage(e){F(this,"mediaerrormessage",e)}}Gi=new WeakMap;wa.getSlotTemplateHTML=Ld;wa.formatErrorMessage=eo;l.customElements.get("media-error-dialog")||l.customElements.define("media-error-dialog",wa);var Rd=wa,Dd=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},Be=(t,e,i)=>(Dd(t,e,"read from private field"),i?i.call(t):e.get(t)),Gr=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},At,Tt;function Cd(t){return`
    <style>
      :host {
        position: fixed;
        top: 0;
        left: 0;
        z-index: 9999;
        background: rgb(20 20 30 / .8);
        backdrop-filter: blur(10px);
      }

      #content {
        display: block;
        width: clamp(400px, 40vw, 700px);
        max-width: 90vw;
        text-align: left;
      }

      h2 {
        margin: 0 0 1.5rem 0;
        font-size: 1.5rem;
        font-weight: 500;
        text-align: center;
      }

      .shortcuts-table {
        width: 100%;
        border-collapse: collapse;
      }

      .shortcuts-table tr {
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }

      .shortcuts-table tr:last-child {
        border-bottom: none;
      }

      .shortcuts-table td {
        padding: 0.75rem 0.5rem;
      }

      .shortcuts-table td:first-child {
        text-align: right;
        padding-right: 1rem;
        width: 40%;
        min-width: 120px;
      }

      .shortcuts-table td:last-child {
        padding-left: 1rem;
      }

      .key {
        display: inline-block;
        background: rgba(255, 255, 255, 0.15);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 4px;
        padding: 0.25rem 0.5rem;
        font-family: 'Courier New', monospace;
        font-size: 0.9rem;
        font-weight: 500;
        min-width: 1.5rem;
        text-align: center;
        margin: 0 0.2rem;
      }

      .description {
        color: rgba(255, 255, 255, 0.9);
        font-size: 0.95rem;
      }

      .key-combo {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 0.3rem;
      }

      .key-separator {
        color: rgba(255, 255, 255, 0.5);
        font-size: 0.9rem;
      }
    </style>
    <slot id="content">
      ${Pd()}
    </slot>
  `}function Pd(){return`
    <h2>Keyboard Shortcuts</h2>
    <table class="shortcuts-table">${[{keys:["Space","k"],description:"Toggle Playback"},{keys:["m"],description:"Toggle mute"},{keys:["f"],description:"Toggle fullscreen"},{keys:["c"],description:"Toggle captions or subtitles, if available"},{keys:["p"],description:"Toggle Picture in Picture"},{keys:["←","j"],description:"Seek back 10s"},{keys:["→","l"],description:"Seek forward 10s"},{keys:["↑"],description:"Turn volume up"},{keys:["↓"],description:"Turn volume down"},{keys:["< (SHIFT+,)"],description:"Decrease playback rate"},{keys:["> (SHIFT+.)"],description:"Increase playback rate"}].map(({keys:i,description:a})=>`
      <tr>
        <td>
          <div class="key-combo">${i.map((r,o)=>o>0?`<span class="key-separator">or</span><span class="key">${r}</span>`:`<span class="key">${r}</span>`).join("")}</div>
        </td>
        <td class="description">${a}</td>
      </tr>
    `).join("")}</table>
  `}class Ws extends nt{constructor(){super(...arguments),Gr(this,At,e=>{var i;if(!this.open)return;const a=(i=this.shadowRoot)==null?void 0:i.querySelector("#content");if(!a)return;const s=e.composedPath(),r=s[0]===this||s.includes(this),o=s.includes(a);r&&!o&&(this.open=!1)}),Gr(this,Tt,e=>{if(!this.open)return;const i=e.shiftKey&&(e.key==="/"||e.key==="?");(e.key==="Escape"||i)&&!e.ctrlKey&&!e.altKey&&!e.metaKey&&(this.open=!1,e.preventDefault(),e.stopPropagation())})}connectedCallback(){super.connectedCallback(),this.open&&(this.addEventListener("click",Be(this,At)),document.addEventListener("keydown",Be(this,Tt)))}disconnectedCallback(){this.removeEventListener("click",Be(this,At)),document.removeEventListener("keydown",Be(this,Tt))}attributeChangedCallback(e,i,a){super.attributeChangedCallback(e,i,a),e==="open"&&(this.open?(this.addEventListener("click",Be(this,At)),document.addEventListener("keydown",Be(this,Tt))):(this.removeEventListener("click",Be(this,At)),document.removeEventListener("keydown",Be(this,Tt))))}}At=new WeakMap;Tt=new WeakMap;Ws.getSlotTemplateHTML=Cd;l.customElements.get("media-keyboard-shortcuts-dialog")||l.customElements.define("media-keyboard-shortcuts-dialog",Ws);var Od=Ws,to=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},xd=(t,e,i)=>(to(t,e,"read from private field"),e.get(t)),Ud=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},Nd=(t,e,i,a)=>(to(t,e,"write to private field"),e.set(t,i),i),qi;const $d=`<svg aria-hidden="true" viewBox="0 0 26 24">
  <path d="M16 3v2.5h3.5V9H22V3h-6ZM4 9h2.5V5.5H10V3H4v6Zm15.5 9.5H16V21h6v-6h-2.5v3.5ZM6.5 15H4v6h6v-2.5H6.5V15Z"/>
</svg>`,Hd=`<svg aria-hidden="true" viewBox="0 0 26 24">
  <path d="M18.5 6.5V3H16v6h6V6.5h-3.5ZM16 21h2.5v-3.5H22V15h-6v6ZM4 17.5h3.5V21H10v-6H4v2.5Zm3.5-11H4V9h6V3H7.5v3.5Z"/>
</svg>`;function Fd(t){return`
    <style>
      :host([${n.MEDIA_IS_FULLSCREEN}]) slot[name=icon] slot:not([name=exit]) {
        display: none !important;
      }

      
      :host(:not([${n.MEDIA_IS_FULLSCREEN}])) slot[name=icon] slot:not([name=enter]) {
        display: none !important;
      }

      :host([${n.MEDIA_IS_FULLSCREEN}]) slot[name=tooltip-enter],
      :host(:not([${n.MEDIA_IS_FULLSCREEN}])) slot[name=tooltip-exit] {
        display: none;
      }
    </style>

    <slot name="icon">
      <slot name="enter">${$d}</slot>
      <slot name="exit">${Hd}</slot>
    </slot>
  `}function Wd(){return`
    <slot name="tooltip-enter">${f("Enter fullscreen mode")}</slot>
    <slot name="tooltip-exit">${f("Exit fullscreen mode")}</slot>
  `}const qr=t=>{const e=t.mediaIsFullscreen?f("exit fullscreen mode"):f("enter fullscreen mode");t.setAttribute("aria-label",e)};let Ra=class extends ee{constructor(){super(...arguments),Ud(this,qi,null)}static get observedAttributes(){return[...super.observedAttributes,n.MEDIA_IS_FULLSCREEN,n.MEDIA_FULLSCREEN_UNAVAILABLE]}connectedCallback(){super.connectedCallback(),qr(this)}attributeChangedCallback(e,i,a){super.attributeChangedCallback(e,i,a),e===n.MEDIA_IS_FULLSCREEN&&qr(this)}get mediaFullscreenUnavailable(){return B(this,n.MEDIA_FULLSCREEN_UNAVAILABLE)}set mediaFullscreenUnavailable(e){F(this,n.MEDIA_FULLSCREEN_UNAVAILABLE,e)}get mediaIsFullscreen(){return M(this,n.MEDIA_IS_FULLSCREEN)}set mediaIsFullscreen(e){L(this,n.MEDIA_IS_FULLSCREEN,e)}handleClick(e){Nd(this,qi,e);const i=xd(this,qi)instanceof PointerEvent,a=this.mediaIsFullscreen?new l.CustomEvent(p.MEDIA_EXIT_FULLSCREEN_REQUEST,{composed:!0,bubbles:!0}):new l.CustomEvent(p.MEDIA_ENTER_FULLSCREEN_REQUEST,{composed:!0,bubbles:!0,detail:i});this.dispatchEvent(a)}};qi=new WeakMap;Ra.getSlotTemplateHTML=Fd;Ra.getTooltipContentHTML=Wd;l.customElements.get("media-fullscreen-button")||l.customElements.define("media-fullscreen-button",Ra);var Bd=Ra;const{MEDIA_TIME_IS_LIVE:Yi,MEDIA_PAUSED:ni}=n,{MEDIA_SEEK_TO_LIVE_REQUEST:Vd,MEDIA_PLAY_REQUEST:Kd}=p,Gd='<svg viewBox="0 0 6 12" aria-hidden="true"><circle cx="3" cy="6" r="2"></circle></svg>';function qd(t){return`
    <style>
      :host { --media-tooltip-display: none; }
      
      slot[name=indicator] > *,
      :host ::slotted([slot=indicator]) {
        
        min-width: auto;
        fill: var(--media-live-button-icon-color, rgb(140, 140, 140));
        color: var(--media-live-button-icon-color, rgb(140, 140, 140));
      }

      :host([${Yi}]:not([${ni}])) slot[name=indicator] > *,
      :host([${Yi}]:not([${ni}])) ::slotted([slot=indicator]) {
        fill: var(--media-live-button-indicator-color, rgb(255, 0, 0));
        color: var(--media-live-button-indicator-color, rgb(255, 0, 0));
      }

      :host([${Yi}]:not([${ni}])) {
        cursor: var(--media-cursor, not-allowed);
      }

      slot[name=text]{
        text-transform: uppercase;
      }

    </style>

    <slot name="indicator">${Gd}</slot>
    
    <slot name="spacer">&nbsp;</slot><slot name="text">${f("live")}</slot>
  `}const Yr=t=>{var e;const i=t.mediaPaused||!t.mediaTimeIsLive,a=f(i?"seek to live":"playing live");t.setAttribute("aria-label",a);const s=(e=t.shadowRoot)==null?void 0:e.querySelector('slot[name="text"]');s&&(s.textContent=f("live")),i?t.removeAttribute("aria-disabled"):t.setAttribute("aria-disabled","true")};class Bs extends ee{static get observedAttributes(){return[...super.observedAttributes,Yi,ni]}connectedCallback(){super.connectedCallback(),Yr(this)}attributeChangedCallback(e,i,a){super.attributeChangedCallback(e,i,a),Yr(this)}get mediaPaused(){return M(this,n.MEDIA_PAUSED)}set mediaPaused(e){L(this,n.MEDIA_PAUSED,e)}get mediaTimeIsLive(){return M(this,n.MEDIA_TIME_IS_LIVE)}set mediaTimeIsLive(e){L(this,n.MEDIA_TIME_IS_LIVE,e)}handleClick(){!this.mediaPaused&&this.mediaTimeIsLive||(this.dispatchEvent(new l.CustomEvent(Vd,{composed:!0,bubbles:!0})),this.hasAttribute(ni)&&this.dispatchEvent(new l.CustomEvent(Kd,{composed:!0,bubbles:!0})))}}Bs.getSlotTemplateHTML=qd;l.customElements.get("media-live-button")||l.customElements.define("media-live-button",Bs);var Yd=Bs,io=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},Bt=(t,e,i)=>(io(t,e,"read from private field"),i?i.call(t):e.get(t)),Qr=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},Vt=(t,e,i,a)=>(io(t,e,"write to private field"),e.set(t,i),i),we,Qi;const Mi={LOADING_DELAY:"loadingdelay",NO_AUTOHIDE:"noautohide"},ao=500,Qd=`
<svg aria-hidden="true" viewBox="0 0 100 100">
  <path d="M73,50c0-12.7-10.3-23-23-23S27,37.3,27,50 M30.9,50c0-10.5,8.5-19.1,19.1-19.1S69.1,39.5,69.1,50">
    <animateTransform
       attributeName="transform"
       attributeType="XML"
       type="rotate"
       dur="1s"
       from="0 50 50"
       to="360 50 50"
       repeatCount="indefinite" />
  </path>
</svg>
`;function zd(t){return`
    <style>
      :host {
        display: var(--media-control-display, var(--media-loading-indicator-display, inline-block));
        vertical-align: middle;
        box-sizing: border-box;
        --_loading-indicator-delay: var(--media-loading-indicator-transition-delay, ${ao}ms);
      }

      #status {
        color: rgba(0,0,0,0);
        width: 0px;
        height: 0px;
      }

      :host slot[name=icon] > *,
      :host ::slotted([slot=icon]) {
        opacity: var(--media-loading-indicator-opacity, 0);
        transition: opacity 0.15s;
      }

      :host([${n.MEDIA_LOADING}]:not([${n.MEDIA_PAUSED}])) slot[name=icon] > *,
      :host([${n.MEDIA_LOADING}]:not([${n.MEDIA_PAUSED}])) ::slotted([slot=icon]) {
        opacity: var(--media-loading-indicator-opacity, 1);
        transition: opacity 0.15s var(--_loading-indicator-delay);
      }

      :host #status {
        visibility: var(--media-loading-indicator-opacity, hidden);
        transition: visibility 0.15s;
      }

      :host([${n.MEDIA_LOADING}]:not([${n.MEDIA_PAUSED}])) #status {
        visibility: var(--media-loading-indicator-opacity, visible);
        transition: visibility 0.15s var(--_loading-indicator-delay);
      }

      svg, img, ::slotted(svg), ::slotted(img) {
        width: var(--media-loading-indicator-icon-width);
        height: var(--media-loading-indicator-icon-height, 100px);
        fill: var(--media-icon-color, var(--media-primary-color, rgb(238 238 238)));
        vertical-align: middle;
      }
    </style>

    <slot name="icon">${Qd}</slot>
    <div id="status" role="status" aria-live="polite">${f("media loading")}</div>
  `}class Da extends l.HTMLElement{constructor(){if(super(),Qr(this,we,void 0),Qr(this,Qi,ao),!this.shadowRoot){this.attachShadow(this.constructor.shadowRootOptions);const e=Ae(this.attributes);this.shadowRoot.innerHTML=this.constructor.getTemplateHTML(e)}}static get observedAttributes(){return[P.MEDIA_CONTROLLER,n.MEDIA_PAUSED,n.MEDIA_LOADING,Mi.LOADING_DELAY]}attributeChangedCallback(e,i,a){var s,r,o,d,c;e===Mi.LOADING_DELAY&&i!==a?this.loadingDelay=Number(a):e===P.MEDIA_CONTROLLER&&(i&&((r=(s=Bt(this,we))==null?void 0:s.unassociateElement)==null||r.call(s,this),Vt(this,we,null)),a&&this.isConnected&&(Vt(this,we,(o=this.getRootNode())==null?void 0:o.getElementById(a)),(c=(d=Bt(this,we))==null?void 0:d.associateElement)==null||c.call(d,this)))}connectedCallback(){var e,i,a;const s=this.getAttribute(P.MEDIA_CONTROLLER);s&&(Vt(this,we,(e=this.getRootNode())==null?void 0:e.getElementById(s)),(a=(i=Bt(this,we))==null?void 0:i.associateElement)==null||a.call(i,this))}disconnectedCallback(){var e,i;(i=(e=Bt(this,we))==null?void 0:e.unassociateElement)==null||i.call(e,this),Vt(this,we,null)}get loadingDelay(){return Bt(this,Qi)}set loadingDelay(e){Vt(this,Qi,e);const{style:i}=Q(this.shadowRoot,":host");i.setProperty("--_loading-indicator-delay",`var(--media-loading-indicator-transition-delay, ${e}ms)`)}get mediaPaused(){return M(this,n.MEDIA_PAUSED)}set mediaPaused(e){L(this,n.MEDIA_PAUSED,e)}get mediaLoading(){return M(this,n.MEDIA_LOADING)}set mediaLoading(e){L(this,n.MEDIA_LOADING,e)}get mediaController(){return B(this,P.MEDIA_CONTROLLER)}set mediaController(e){F(this,P.MEDIA_CONTROLLER,e)}get noAutohide(){return M(this,Mi.NO_AUTOHIDE)}set noAutohide(e){L(this,Mi.NO_AUTOHIDE,e)}}we=new WeakMap;Qi=new WeakMap;Da.shadowRootOptions={mode:"open"};Da.getTemplateHTML=zd;l.customElements.get("media-loading-indicator")||l.customElements.define("media-loading-indicator",Da);var Zd=Da;const Xd=`<svg aria-hidden="true" viewBox="0 0 24 24">
  <path d="M16.5 12A4.5 4.5 0 0 0 14 8v2.18l2.45 2.45a4.22 4.22 0 0 0 .05-.63Zm2.5 0a6.84 6.84 0 0 1-.54 2.64L20 16.15A8.8 8.8 0 0 0 21 12a9 9 0 0 0-7-8.77v2.06A7 7 0 0 1 19 12ZM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25A6.92 6.92 0 0 1 14 18.7v2.06A9 9 0 0 0 17.69 19l2 2.05L21 19.73l-9-9L4.27 3ZM12 4 9.91 6.09 12 8.18V4Z"/>
</svg>`,zr=`<svg aria-hidden="true" viewBox="0 0 24 24">
  <path d="M3 9v6h4l5 5V4L7 9H3Zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.47 4.47 0 0 0 2.5-4Z"/>
</svg>`,Jd=`<svg aria-hidden="true" viewBox="0 0 24 24">
  <path d="M3 9v6h4l5 5V4L7 9H3Zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.47 4.47 0 0 0 2.5-4ZM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06a9 9 0 0 0 0-17.54Z"/>
</svg>`;function jd(t){return`
    <style>
      :host(:not([${n.MEDIA_VOLUME_LEVEL}])) slot[name=icon] slot:not([name=high]),
      :host([${n.MEDIA_VOLUME_LEVEL}=high]) slot[name=icon] slot:not([name=high]) {
        display: none !important;
      }

      :host([${n.MEDIA_VOLUME_LEVEL}=off]) slot[name=icon] slot:not([name=off]) {
        display: none !important;
      }

      :host([${n.MEDIA_VOLUME_LEVEL}=low]) slot[name=icon] slot:not([name=low]) {
        display: none !important;
      }

      :host([${n.MEDIA_VOLUME_LEVEL}=medium]) slot[name=icon] slot:not([name=medium]) {
        display: none !important;
      }

      :host(:not([${n.MEDIA_VOLUME_LEVEL}=off])) slot[name=tooltip-unmute],
      :host([${n.MEDIA_VOLUME_LEVEL}=off]) slot[name=tooltip-mute] {
        display: none;
      }
    </style>

    <slot name="icon">
      <slot name="off">${Xd}</slot>
      <slot name="low">${zr}</slot>
      <slot name="medium">${zr}</slot>
      <slot name="high">${Jd}</slot>
    </slot>
  `}function ec(){return`
    <slot name="tooltip-mute">${f("Mute")}</slot>
    <slot name="tooltip-unmute">${f("Unmute")}</slot>
  `}const Zr=t=>{const e=t.mediaVolumeLevel==="off",i=f(e?"unmute":"mute");t.setAttribute("aria-label",i)};let Ca=class extends ee{static get observedAttributes(){return[...super.observedAttributes,n.MEDIA_VOLUME_LEVEL]}connectedCallback(){super.connectedCallback(),Zr(this)}attributeChangedCallback(e,i,a){super.attributeChangedCallback(e,i,a),e===n.MEDIA_VOLUME_LEVEL&&Zr(this)}get mediaVolumeLevel(){return B(this,n.MEDIA_VOLUME_LEVEL)}set mediaVolumeLevel(e){F(this,n.MEDIA_VOLUME_LEVEL,e)}handleClick(){const e=this.mediaVolumeLevel==="off"?p.MEDIA_UNMUTE_REQUEST:p.MEDIA_MUTE_REQUEST;this.dispatchEvent(new l.CustomEvent(e,{composed:!0,bubbles:!0}))}};Ca.getSlotTemplateHTML=jd;Ca.getTooltipContentHTML=ec;l.customElements.get("media-mute-button")||l.customElements.define("media-mute-button",Ca);var tc=Ca;const Xr=`<svg aria-hidden="true" viewBox="0 0 28 24">
  <path d="M24 3H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h20a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1Zm-1 16H5V5h18v14Zm-3-8h-7v5h7v-5Z"/>
</svg>`;function ic(t){return`
    <style>
      :host([${n.MEDIA_IS_PIP}]) slot[name=icon] slot:not([name=exit]) {
        display: none !important;
      }

      :host(:not([${n.MEDIA_IS_PIP}])) slot[name=icon] slot:not([name=enter]) {
        display: none !important;
      }

      :host([${n.MEDIA_IS_PIP}]) slot[name=tooltip-enter],
      :host(:not([${n.MEDIA_IS_PIP}])) slot[name=tooltip-exit] {
        display: none;
      }
    </style>

    <slot name="icon">
      <slot name="enter">${Xr}</slot>
      <slot name="exit">${Xr}</slot>
    </slot>
  `}function ac(){return`
    <slot name="tooltip-enter">${f("Enter picture in picture mode")}</slot>
    <slot name="tooltip-exit">${f("Exit picture in picture mode")}</slot>
  `}const Jr=t=>{const e=t.mediaIsPip?f("exit picture in picture mode"):f("enter picture in picture mode");t.setAttribute("aria-label",e)};class Pa extends ee{static get observedAttributes(){return[...super.observedAttributes,n.MEDIA_IS_PIP,n.MEDIA_PIP_UNAVAILABLE]}connectedCallback(){super.connectedCallback(),Jr(this)}attributeChangedCallback(e,i,a){super.attributeChangedCallback(e,i,a),e===n.MEDIA_IS_PIP&&Jr(this)}get mediaPipUnavailable(){return B(this,n.MEDIA_PIP_UNAVAILABLE)}set mediaPipUnavailable(e){F(this,n.MEDIA_PIP_UNAVAILABLE,e)}get mediaIsPip(){return M(this,n.MEDIA_IS_PIP)}set mediaIsPip(e){L(this,n.MEDIA_IS_PIP,e)}handleClick(){const e=this.mediaIsPip?p.MEDIA_EXIT_PIP_REQUEST:p.MEDIA_ENTER_PIP_REQUEST;this.dispatchEvent(new l.CustomEvent(e,{composed:!0,bubbles:!0}))}}Pa.getSlotTemplateHTML=ic;Pa.getTooltipContentHTML=ac;l.customElements.get("media-pip-button")||l.customElements.define("media-pip-button",Pa);var sc=Pa,rc=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},ht=(t,e,i)=>(rc(t,e,"read from private field"),i?i.call(t):e.get(t)),nc=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},qe;const qa={RATES:"rates"},oc=[1,1.2,1.5,1.7,2],Xt=1;function _s(t){return Math.round(t*100)/100}function lc(t){return`
    <style>
      :host {
        min-width: 5ch;
        padding: var(--media-button-padding, var(--media-control-padding, 10px 5px));
      }
    </style>
    <slot name="icon">${t.mediaplaybackrate?_s(+t.mediaplaybackrate):Xt}x</slot>
  `}function dc(){return f("Playback rate")}let Oa=class extends ee{constructor(){var e;super(),nc(this,qe,new kn(this,qa.RATES,{defaultValue:oc})),this.container=this.shadowRoot.querySelector('slot[name="icon"]'),this.container.innerHTML=`${_s((e=this.mediaPlaybackRate)!=null?e:Xt)}x`}static get observedAttributes(){return[...super.observedAttributes,n.MEDIA_PLAYBACK_RATE,qa.RATES]}attributeChangedCallback(e,i,a){if(super.attributeChangedCallback(e,i,a),e===qa.RATES&&(ht(this,qe).value=a),e===n.MEDIA_PLAYBACK_RATE){const s=a?+a:Number.NaN,r=_s(Number.isNaN(s)?Xt:s);this.container.innerHTML=`${r}x`,this.setAttribute("aria-label",f("Playback rate {playbackRate}",{playbackRate:r}))}}get rates(){return ht(this,qe)}set rates(e){e?Array.isArray(e)?ht(this,qe).value=e.join(" "):typeof e=="string"&&(ht(this,qe).value=e):ht(this,qe).value=""}get mediaPlaybackRate(){return H(this,n.MEDIA_PLAYBACK_RATE,Xt)}set mediaPlaybackRate(e){j(this,n.MEDIA_PLAYBACK_RATE,e)}handleClick(){var e,i;const a=Array.from(ht(this,qe).values(),o=>+o).sort((o,d)=>o-d),s=(i=(e=a.find(o=>o>this.mediaPlaybackRate))!=null?e:a[0])!=null?i:Xt,r=new l.CustomEvent(p.MEDIA_PLAYBACK_RATE_REQUEST,{composed:!0,bubbles:!0,detail:s});this.dispatchEvent(r)}};qe=new WeakMap;Oa.getSlotTemplateHTML=lc;Oa.getTooltipContentHTML=dc;l.customElements.get("media-playback-rate-button")||l.customElements.define("media-playback-rate-button",Oa);var cc=Oa;const uc=`<svg aria-hidden="true" viewBox="0 0 24 24">
  <path d="m6 21 15-9L6 3v18Z"/>
</svg>`,hc=`<svg aria-hidden="true" viewBox="0 0 24 24">
  <path d="M6 20h4V4H6v16Zm8-16v16h4V4h-4Z"/>
</svg>`;function mc(t){return`
    <style>
      :host([${n.MEDIA_PAUSED}]) slot[name=pause],
      :host(:not([${n.MEDIA_PAUSED}])) slot[name=play] {
        display: none !important;
      }

      :host([${n.MEDIA_PAUSED}]) slot[name=tooltip-pause],
      :host(:not([${n.MEDIA_PAUSED}])) slot[name=tooltip-play] {
        display: none;
      }
    </style>

    <slot name="icon">
      <slot name="play">${uc}</slot>
      <slot name="pause">${hc}</slot>
    </slot>
  `}function pc(){return`
    <slot name="tooltip-play">${f("Play")}</slot>
    <slot name="tooltip-pause">${f("Pause")}</slot>
  `}const jr=t=>{const e=t.mediaPaused?f("play"):f("pause");t.setAttribute("aria-label",e)};let xa=class extends ee{static get observedAttributes(){return[...super.observedAttributes,n.MEDIA_PAUSED,n.MEDIA_ENDED]}connectedCallback(){super.connectedCallback(),jr(this)}attributeChangedCallback(e,i,a){super.attributeChangedCallback(e,i,a),(e===n.MEDIA_PAUSED||e===n.MEDIA_LANG)&&jr(this)}get mediaPaused(){return M(this,n.MEDIA_PAUSED)}set mediaPaused(e){L(this,n.MEDIA_PAUSED,e)}handleClick(){const e=this.mediaPaused?p.MEDIA_PLAY_REQUEST:p.MEDIA_PAUSE_REQUEST;this.dispatchEvent(new l.CustomEvent(e,{composed:!0,bubbles:!0}))}};xa.getSlotTemplateHTML=mc;xa.getTooltipContentHTML=pc;l.customElements.get("media-play-button")||l.customElements.define("media-play-button",xa);var Ec=xa;const Te={PLACEHOLDER_SRC:"placeholdersrc",SRC:"src"};function vc(t){return`
    <style>
      :host {
        pointer-events: none;
        display: var(--media-poster-image-display, inline-block);
        box-sizing: border-box;
      }

      img {
        max-width: 100%;
        max-height: 100%;
        min-width: 100%;
        min-height: 100%;
        background-repeat: no-repeat;
        background-position: var(--media-poster-image-background-position, var(--media-object-position, center));
        background-size: var(--media-poster-image-background-size, var(--media-object-fit, contain));
        object-fit: var(--media-object-fit, contain);
        object-position: var(--media-object-position, center);
      }
    </style>

    <img part="poster img" aria-hidden="true" id="image"/>
  `}const fc=t=>{t.style.removeProperty("background-image")},_c=(t,e)=>{t.style["background-image"]=`url('${e}')`};class Ua extends l.HTMLElement{static get observedAttributes(){return[Te.PLACEHOLDER_SRC,Te.SRC]}constructor(){if(super(),!this.shadowRoot){this.attachShadow(this.constructor.shadowRootOptions);const e=Ae(this.attributes);this.shadowRoot.innerHTML=this.constructor.getTemplateHTML(e)}this.image=this.shadowRoot.querySelector("#image")}attributeChangedCallback(e,i,a){e===Te.SRC&&(a==null?this.image.removeAttribute(Te.SRC):this.image.setAttribute(Te.SRC,a)),e===Te.PLACEHOLDER_SRC&&(a==null?fc(this.image):_c(this.image,a))}get placeholderSrc(){return B(this,Te.PLACEHOLDER_SRC)}set placeholderSrc(e){F(this,Te.SRC,e)}get src(){return B(this,Te.SRC)}set src(e){F(this,Te.SRC,e)}}Ua.shadowRootOptions={mode:"open"};Ua.getTemplateHTML=vc;l.customElements.get("media-poster-image")||l.customElements.define("media-poster-image",Ua);var gc=Ua,so=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},bc=(t,e,i)=>(so(t,e,"read from private field"),i?i.call(t):e.get(t)),Ac=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},Tc=(t,e,i,a)=>(so(t,e,"write to private field"),e.set(t,i),i),zi;class ro extends He{constructor(){super(),Ac(this,zi,void 0),Tc(this,zi,this.shadowRoot.querySelector("slot"))}static get observedAttributes(){return[...super.observedAttributes,n.MEDIA_PREVIEW_CHAPTER,n.MEDIA_LANG]}attributeChangedCallback(e,i,a){if(super.attributeChangedCallback(e,i,a),(e===n.MEDIA_PREVIEW_CHAPTER||e===n.MEDIA_LANG)&&a!==i&&a!=null)if(bc(this,zi).textContent=a,a!==""){const s=f("chapter: {chapterName}",{chapterName:a});this.setAttribute("aria-valuetext",s)}else this.removeAttribute("aria-valuetext")}get mediaPreviewChapter(){return B(this,n.MEDIA_PREVIEW_CHAPTER)}set mediaPreviewChapter(e){F(this,n.MEDIA_PREVIEW_CHAPTER,e)}}zi=new WeakMap;l.customElements.get("media-preview-chapter-display")||l.customElements.define("media-preview-chapter-display",ro);var Ic=ro,no=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},Li=(t,e,i)=>(no(t,e,"read from private field"),i?i.call(t):e.get(t)),yc=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},wi=(t,e,i,a)=>(no(t,e,"write to private field"),e.set(t,i),i),Re;function Sc(t){return`
    <style>
      :host {
        box-sizing: border-box;
        display: var(--media-control-display, var(--media-preview-thumbnail-display, inline-block));
        overflow: hidden;
      }

      img {
        display: none;
        position: relative;
      }
    </style>
    <img crossorigin loading="eager" decoding="async">
  `}class Na extends l.HTMLElement{constructor(){if(super(),yc(this,Re,void 0),!this.shadowRoot){this.attachShadow(this.constructor.shadowRootOptions);const e=Ae(this.attributes);this.shadowRoot.innerHTML=this.constructor.getTemplateHTML(e)}}static get observedAttributes(){return[P.MEDIA_CONTROLLER,n.MEDIA_PREVIEW_IMAGE,n.MEDIA_PREVIEW_COORDS]}connectedCallback(){var e,i,a;const s=this.getAttribute(P.MEDIA_CONTROLLER);s&&(wi(this,Re,(e=this.getRootNode())==null?void 0:e.getElementById(s)),(a=(i=Li(this,Re))==null?void 0:i.associateElement)==null||a.call(i,this))}disconnectedCallback(){var e,i;(i=(e=Li(this,Re))==null?void 0:e.unassociateElement)==null||i.call(e,this),wi(this,Re,null)}attributeChangedCallback(e,i,a){var s,r,o,d,c;[n.MEDIA_PREVIEW_IMAGE,n.MEDIA_PREVIEW_COORDS].includes(e)&&this.update(),e===P.MEDIA_CONTROLLER&&(i&&((r=(s=Li(this,Re))==null?void 0:s.unassociateElement)==null||r.call(s,this),wi(this,Re,null)),a&&this.isConnected&&(wi(this,Re,(o=this.getRootNode())==null?void 0:o.getElementById(a)),(c=(d=Li(this,Re))==null?void 0:d.associateElement)==null||c.call(d,this)))}get mediaPreviewImage(){return B(this,n.MEDIA_PREVIEW_IMAGE)}set mediaPreviewImage(e){F(this,n.MEDIA_PREVIEW_IMAGE,e)}get mediaPreviewCoords(){const e=this.getAttribute(n.MEDIA_PREVIEW_COORDS);if(e)return e.split(/\s+/).map(i=>+i)}set mediaPreviewCoords(e){if(!e){this.removeAttribute(n.MEDIA_PREVIEW_COORDS);return}this.setAttribute(n.MEDIA_PREVIEW_COORDS,e.join(" "))}update(){const e=this.mediaPreviewCoords,i=this.mediaPreviewImage;if(!(e&&i))return;const[a,s,r,o]=e,d=i.split("#")[0],c=getComputedStyle(this),{maxWidth:y,maxHeight:I,minWidth:g,minHeight:E}=c,m=c.getPropertyValue("--media-preview-thumbnail-object-fit").trim()||"contain";let h,v;if(m==="fill"){const V=parseInt(y)/r,de=parseInt(I)/o,Fe=parseInt(g)/r,ae=parseInt(E)/o;h=V<1?V:Math.max(V,Fe),v=de<1?de:Math.max(de,ae)}else{const V=Math.min(parseInt(y)/r,parseInt(I)/o),de=Math.max(parseInt(g)/r,parseInt(E)/o),ae=V<1?V:de>1?de:1;h=ae,v=ae}const{style:A}=Q(this.shadowRoot,":host"),T=Q(this.shadowRoot,"img").style,S=this.shadowRoot.querySelector("img"),N=Math.min(h,v)<1?"min":"max";A.setProperty(`${N}-width`,"initial","important"),A.setProperty(`${N}-height`,"initial","important"),A.width=`${r*h}px`,A.height=`${o*v}px`;const z=()=>{T.width=`${this.imgWidth*h}px`,T.height=`${this.imgHeight*v}px`,T.display="block"};S.src!==d&&(S.onload=()=>{this.imgWidth=S.naturalWidth,this.imgHeight=S.naturalHeight,z(),S.onload=null},S.src=d,z()),z(),T.transform=`translate(-${a*h}px, -${s*v}px)`}}Re=new WeakMap;Na.shadowRootOptions={mode:"open"};Na.getTemplateHTML=Sc;l.customElements.get("media-preview-thumbnail")||l.customElements.define("media-preview-thumbnail",Na);var gs=Na,oo=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},en=(t,e,i)=>(oo(t,e,"read from private field"),i?i.call(t):e.get(t)),kc=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},Mc=(t,e,i,a)=>(oo(t,e,"write to private field"),e.set(t,i),i),Jt;class lo extends He{constructor(){super(),kc(this,Jt,void 0),Mc(this,Jt,this.shadowRoot.querySelector("slot")),en(this,Jt).textContent=Xe(0)}static get observedAttributes(){return[...super.observedAttributes,n.MEDIA_PREVIEW_TIME]}attributeChangedCallback(e,i,a){super.attributeChangedCallback(e,i,a),e===n.MEDIA_PREVIEW_TIME&&a!=null&&(en(this,Jt).textContent=Xe(parseFloat(a)))}get mediaPreviewTime(){return H(this,n.MEDIA_PREVIEW_TIME)}set mediaPreviewTime(e){j(this,n.MEDIA_PREVIEW_TIME,e)}}Jt=new WeakMap;l.customElements.get("media-preview-time-display")||l.customElements.define("media-preview-time-display",lo);var Lc=lo;const mt={SEEK_OFFSET:"seekoffset"},Ya=30,wc=t=>`
  <svg aria-hidden="true" viewBox="0 0 20 24">
    <defs>
      <style>.text{font-size:8px;font-family:Arial-BoldMT, Arial;font-weight:700;}</style>
    </defs>
    <text class="text value" transform="translate(2.18 19.87)">${t}</text>
    <path d="M10 6V3L4.37 7 10 10.94V8a5.54 5.54 0 0 1 1.9 10.48v2.12A7.5 7.5 0 0 0 10 6Z"/>
  </svg>`;function Rc(t,e){return`
    <slot name="icon">${wc(e.seekOffset)}</slot>
  `}const Dc=(t,e)=>{t.setAttribute("aria-label",f("seek back {seekOffset} seconds",{seekOffset:e}))};function Cc(){return f("Seek backward")}const Pc=0;class $a extends ee{static get observedAttributes(){return[...super.observedAttributes,n.MEDIA_CURRENT_TIME,mt.SEEK_OFFSET]}connectedCallback(){super.connectedCallback(),this.seekOffset=H(this,mt.SEEK_OFFSET,Ya)}attributeChangedCallback(e,i,a){super.attributeChangedCallback(e,i,a),Dc(this,this.seekOffset),e===mt.SEEK_OFFSET&&(this.seekOffset=H(this,mt.SEEK_OFFSET,Ya))}get seekOffset(){return H(this,mt.SEEK_OFFSET,Ya)}set seekOffset(e){j(this,mt.SEEK_OFFSET,e),this.setAttribute("aria-label",f("seek back {seekOffset} seconds",{seekOffset:this.seekOffset})),vn(fn(this,"icon"),this.seekOffset)}get mediaCurrentTime(){return H(this,n.MEDIA_CURRENT_TIME,Pc)}set mediaCurrentTime(e){j(this,n.MEDIA_CURRENT_TIME,e)}handleClick(){const e=Math.max(this.mediaCurrentTime-this.seekOffset,0),i=new l.CustomEvent(p.MEDIA_SEEK_REQUEST,{composed:!0,bubbles:!0,detail:e});this.dispatchEvent(i)}}$a.getSlotTemplateHTML=Rc;$a.getTooltipContentHTML=Cc;l.customElements.get("media-seek-backward-button")||l.customElements.define("media-seek-backward-button",$a);var Oc=$a;const pt={SEEK_OFFSET:"seekoffset"},Qa=30,xc=t=>`
  <svg aria-hidden="true" viewBox="0 0 20 24">
    <defs>
      <style>.text{font-size:8px;font-family:Arial-BoldMT, Arial;font-weight:700;}</style>
    </defs>
    <text class="text value" transform="translate(8.9 19.87)">${t}</text>
    <path d="M10 6V3l5.61 4L10 10.94V8a5.54 5.54 0 0 0-1.9 10.48v2.12A7.5 7.5 0 0 1 10 6Z"/>
  </svg>`;function Uc(t,e){return`
    <slot name="icon">${xc(e.seekOffset)}</slot>
  `}const Nc=(t,e)=>{t.setAttribute("aria-label",f("seek forward {seekOffset} seconds",{seekOffset:e}))};function $c(){return f("Seek forward")}const Hc=0;class Ha extends ee{static get observedAttributes(){return[...super.observedAttributes,n.MEDIA_CURRENT_TIME,pt.SEEK_OFFSET]}connectedCallback(){super.connectedCallback(),this.seekOffset=H(this,pt.SEEK_OFFSET,Qa)}attributeChangedCallback(e,i,a){super.attributeChangedCallback(e,i,a),Nc(this,this.seekOffset),e===pt.SEEK_OFFSET&&(this.seekOffset=H(this,pt.SEEK_OFFSET,Qa))}get seekOffset(){return H(this,pt.SEEK_OFFSET,Qa)}set seekOffset(e){j(this,pt.SEEK_OFFSET,e),this.setAttribute("aria-label",f("seek forward {seekOffset} seconds",{seekOffset:this.seekOffset})),vn(fn(this,"icon"),this.seekOffset)}get mediaCurrentTime(){return H(this,n.MEDIA_CURRENT_TIME,Hc)}set mediaCurrentTime(e){j(this,n.MEDIA_CURRENT_TIME,e)}handleClick(){const e=this.mediaCurrentTime+this.seekOffset,i=new l.CustomEvent(p.MEDIA_SEEK_REQUEST,{composed:!0,bubbles:!0,detail:e});this.dispatchEvent(i)}}Ha.getSlotTemplateHTML=Uc;Ha.getTooltipContentHTML=$c;l.customElements.get("media-seek-forward-button")||l.customElements.define("media-seek-forward-button",Ha);var Fc=Ha,Vs=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},ge=(t,e,i)=>(Vs(t,e,"read from private field"),i?i.call(t):e.get(t)),je=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},Ks=(t,e,i,a)=>(Vs(t,e,"write to private field"),e.set(t,i),i),Qe=(t,e,i)=>(Vs(t,e,"access private method"),i),It,Pe,Fa,Gs,co,ha,qs,jt,Zi,Xi,bs;const Ye={REMAINING:"remaining",SHOW_DURATION:"showduration",NO_TOGGLE:"notoggle"},tn=[...Object.values(Ye),n.MEDIA_CURRENT_TIME,n.MEDIA_DURATION,n.MEDIA_SEEKABLE],uo=["Enter"," "],Wc="&nbsp;/&nbsp;",As=(t,{timesSep:e=Wc}={})=>{var i,a;const s=(i=t.mediaCurrentTime)!=null?i:0,[,r]=(a=t.mediaSeekable)!=null?a:[];let o=0;Number.isFinite(t.mediaDuration)?o=t.mediaDuration:Number.isFinite(r)&&(o=r);const d=t.remaining?Xe(0-(o-s)):Xe(s);return t.showDuration?`${d}${e}${Xe(o)}`:d},Bc=t=>{var e;const i=t.mediaCurrentTime,[,a]=(e=t.mediaSeekable)!=null?e:[];let s=null;if(Number.isFinite(t.mediaDuration)?s=t.mediaDuration:Number.isFinite(a)&&(s=a),i==null||s===null){t.setAttribute("aria-description",f("video not loaded, unknown time."));return}const r=t.remaining?si(0-(s-i)):si(i);if(!t.showDuration){t.setAttribute("aria-description",r);return}const o=si(s),d=f("{currentTime} of {totalTime}",{currentTime:r,totalTime:o});t.setAttribute("aria-description",d)};function Vc(t,e){return`
    <slot>${As(e)}</slot>
  `}const Kc=t=>{t.setAttribute("aria-label",f("playback time"))};let Ys=class extends He{constructor(){super(),je(this,Gs),je(this,ha),je(this,jt),je(this,Xi),je(this,It,void 0),je(this,Pe,null),je(this,Fa,e=>{const{metaKey:i,altKey:a,key:s}=e;if(i||a||!uo.includes(s)){this.removeEventListener("keyup",ge(this,Pe));return}this.addEventListener("keyup",ge(this,Pe))}),Ks(this,It,this.shadowRoot.querySelector("slot")),ge(this,It).innerHTML=`${As(this)}`}static get observedAttributes(){return[...super.observedAttributes,...tn,"disabled"]}connectedCallback(){const{style:e}=Q(this.shadowRoot,":host(:hover:not([notoggle]))");e.setProperty("cursor","var(--media-cursor, pointer)"),e.setProperty("background","var(--media-control-hover-background, rgba(50 50 70 / .7))"),this.setAttribute("aria-label",f("playback time")),Qe(this,jt,Zi).call(this),super.connectedCallback()}toggleTimeDisplay(){this.noToggle||(this.hasAttribute("remaining")?this.removeAttribute("remaining"):this.setAttribute("remaining",""))}disconnectedCallback(){this.disable(),Qe(this,ha,qs).call(this),super.disconnectedCallback()}attributeChangedCallback(e,i,a){Kc(this),tn.includes(e)?this.update():e==="disabled"&&a!==i?a==null?Qe(this,jt,Zi).call(this):Qe(this,Xi,bs).call(this):e===Ye.NO_TOGGLE&&a!==i&&(this.noToggle?Qe(this,Xi,bs).call(this):Qe(this,jt,Zi).call(this)),super.attributeChangedCallback(e,i,a)}enable(){this.noToggle||(this.tabIndex=0)}disable(){this.tabIndex=-1}get remaining(){return M(this,Ye.REMAINING)}set remaining(e){L(this,Ye.REMAINING,e)}get showDuration(){return M(this,Ye.SHOW_DURATION)}set showDuration(e){L(this,Ye.SHOW_DURATION,e)}get noToggle(){return M(this,Ye.NO_TOGGLE)}set noToggle(e){L(this,Ye.NO_TOGGLE,e)}get mediaDuration(){return H(this,n.MEDIA_DURATION)}set mediaDuration(e){j(this,n.MEDIA_DURATION,e)}get mediaCurrentTime(){return H(this,n.MEDIA_CURRENT_TIME)}set mediaCurrentTime(e){j(this,n.MEDIA_CURRENT_TIME,e)}get mediaSeekable(){const e=this.getAttribute(n.MEDIA_SEEKABLE);if(e)return e.split(":").map(i=>+i)}set mediaSeekable(e){if(e==null){this.removeAttribute(n.MEDIA_SEEKABLE);return}this.setAttribute(n.MEDIA_SEEKABLE,e.join(":"))}update(){const e=As(this);Bc(this),e!==ge(this,It).innerHTML&&(ge(this,It).innerHTML=e)}};It=new WeakMap;Pe=new WeakMap;Fa=new WeakMap;Gs=new WeakSet;co=function(){ge(this,Pe)||(Ks(this,Pe,t=>{const{key:e}=t;if(!uo.includes(e)){this.removeEventListener("keyup",ge(this,Pe));return}this.toggleTimeDisplay()}),this.addEventListener("keydown",ge(this,Fa)),this.addEventListener("click",this.toggleTimeDisplay))};ha=new WeakSet;qs=function(){ge(this,Pe)&&(this.removeEventListener("keyup",ge(this,Pe)),this.removeEventListener("keydown",ge(this,Fa)),this.removeEventListener("click",this.toggleTimeDisplay),Ks(this,Pe,null))};jt=new WeakSet;Zi=function(){!this.noToggle&&!this.hasAttribute("disabled")&&(this.setAttribute("role","button"),this.enable(),Qe(this,Gs,co).call(this))};Xi=new WeakSet;bs=function(){this.removeAttribute("role"),this.disable(),Qe(this,ha,qs).call(this)};Ys.getSlotTemplateHTML=Vc;l.customElements.get("media-time-display")||l.customElements.define("media-time-display",Ys);var Gc=Ys,ho=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},X=(t,e,i)=>(ho(t,e,"read from private field"),e.get(t)),Ie=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},le=(t,e,i,a)=>(ho(t,e,"write to private field"),e.set(t,i),i),qc=(t,e,i,a)=>({set _(s){le(t,e,s)},get _(){return X(t,e)}}),yt,Ji,St,ei,ji,ea,ta,kt,tt,ia;class Yc{constructor(e,i,a){Ie(this,yt,void 0),Ie(this,Ji,void 0),Ie(this,St,void 0),Ie(this,ei,void 0),Ie(this,ji,void 0),Ie(this,ea,void 0),Ie(this,ta,void 0),Ie(this,kt,void 0),Ie(this,tt,0),Ie(this,ia,(s=performance.now())=>{le(this,tt,requestAnimationFrame(X(this,ia))),le(this,ei,performance.now()-X(this,St));const r=1e3/this.fps;if(X(this,ei)>r){le(this,St,s-X(this,ei)%r);const o=1e3/((s-X(this,Ji))/++qc(this,ji)._),d=(s-X(this,ea))/1e3/this.duration;let c=X(this,ta)+d*this.playbackRate;c-X(this,yt).valueAsNumber>0?le(this,kt,this.playbackRate/this.duration/o):(le(this,kt,.995*X(this,kt)),c=X(this,yt).valueAsNumber+X(this,kt)),this.callback(c)}}),le(this,yt,e),this.callback=i,this.fps=a}start(){X(this,tt)===0&&(le(this,St,performance.now()),le(this,Ji,X(this,St)),le(this,ji,0),X(this,ia).call(this))}stop(){X(this,tt)!==0&&(cancelAnimationFrame(X(this,tt)),le(this,tt,0))}update({start:e,duration:i,playbackRate:a}){const s=e-X(this,yt).valueAsNumber,r=Math.abs(i-this.duration);(s>0||s<-.03||r>=.5)&&this.callback(e),le(this,ta,e),le(this,ea,performance.now()),this.duration=i,this.playbackRate=a}}yt=new WeakMap;Ji=new WeakMap;St=new WeakMap;ei=new WeakMap;ji=new WeakMap;ea=new WeakMap;ta=new WeakMap;kt=new WeakMap;tt=new WeakMap;ia=new WeakMap;var Qs=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},x=(t,e,i)=>(Qs(t,e,"read from private field"),i?i.call(t):e.get(t)),q=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},ue=(t,e,i,a)=>(Qs(t,e,"write to private field"),e.set(t,i),i),he=(t,e,i)=>(Qs(t,e,"access private method"),i),Mt,ze,ma,oi,pa,aa,hi,mi,Lt,wt,ti,Ts,mo,Is,Ea,zs,va,Zs,fa,Xs,ys,po,pi,_a,Ss,Eo;const Qc=t=>{const e=t.range,i=si(+vo(t)),a=si(+t.mediaSeekableEnd),s=i&&a?f("{currentTime} of {totalTime}",{currentTime:i,totalTime:a}):f("video not loaded, unknown time.");e.setAttribute("aria-valuetext",s)};function zc(t){return`
    <style>
      :host {
        --media-box-border-radius: 4px;
        --media-box-padding-left: 10px;
        --media-box-padding-right: 10px;
        --media-preview-border-radius: var(--media-box-border-radius);
        --media-box-arrow-offset: var(--media-box-border-radius);
        --_control-background: var(--media-control-background, var(--media-secondary-color, rgb(20 20 30 / .7)));
        --_preview-background: var(--media-preview-background, var(--_control-background));

        
        contain: layout;
      }

      #buffered {
        background: var(--media-time-range-buffered-color, rgb(255 255 255 / .4));
        position: absolute;
        height: 100%;
        will-change: width;
      }

      #preview-rail,
      #current-rail {
        width: 100%;
        position: absolute;
        left: 0;
        bottom: 100%;
        pointer-events: none;
        will-change: transform;
      }

      [part~="box"] {
        width: min-content;
        
        position: absolute;
        bottom: 100%;
        flex-direction: column;
        align-items: center;
        transform: translateX(-50%);
      }

      [part~="current-box"] {
        display: var(--media-current-box-display, var(--media-box-display, flex));
        margin: var(--media-current-box-margin, var(--media-box-margin, 0 0 5px));
        visibility: hidden;
      }

      [part~="preview-box"] {
        display: var(--media-preview-box-display, var(--media-box-display, flex));
        margin: var(--media-preview-box-margin, var(--media-box-margin, 0 0 5px));
        transition-property: var(--media-preview-transition-property, visibility, opacity);
        transition-duration: var(--media-preview-transition-duration-out, .25s);
        transition-delay: var(--media-preview-transition-delay-out, 0s);
        visibility: hidden;
        opacity: 0;
      }

      :host(:is([${n.MEDIA_PREVIEW_IMAGE}], [${n.MEDIA_PREVIEW_TIME}])[dragging]) [part~="preview-box"] {
        transition-duration: var(--media-preview-transition-duration-in, .5s);
        transition-delay: var(--media-preview-transition-delay-in, .25s);
        visibility: visible;
        opacity: 1;
      }

      @media (hover: hover) {
        :host(:is([${n.MEDIA_PREVIEW_IMAGE}], [${n.MEDIA_PREVIEW_TIME}]):hover) [part~="preview-box"] {
          transition-duration: var(--media-preview-transition-duration-in, .5s);
          transition-delay: var(--media-preview-transition-delay-in, .25s);
          visibility: visible;
          opacity: 1;
        }
      }

      media-preview-thumbnail,
      ::slotted(media-preview-thumbnail) {
        visibility: hidden;
        
        transition: visibility 0s .25s;
        transition-delay: calc(var(--media-preview-transition-delay-out, 0s) + var(--media-preview-transition-duration-out, .25s));
        background: var(--media-preview-thumbnail-background, var(--_preview-background));
        box-shadow: var(--media-preview-thumbnail-box-shadow, 0 0 4px rgb(0 0 0 / .2));
        max-width: var(--media-preview-thumbnail-max-width, 180px);
        max-height: var(--media-preview-thumbnail-max-height, 160px);
        min-width: var(--media-preview-thumbnail-min-width, 120px);
        min-height: var(--media-preview-thumbnail-min-height, 80px);
        border: var(--media-preview-thumbnail-border);
        border-radius: var(--media-preview-thumbnail-border-radius,
          var(--media-preview-border-radius) var(--media-preview-border-radius) 0 0);
      }

      :host([${n.MEDIA_PREVIEW_IMAGE}][dragging]) media-preview-thumbnail,
      :host([${n.MEDIA_PREVIEW_IMAGE}][dragging]) ::slotted(media-preview-thumbnail) {
        transition-delay: var(--media-preview-transition-delay-in, .25s);
        visibility: visible;
      }

      @media (hover: hover) {
        :host([${n.MEDIA_PREVIEW_IMAGE}]:hover) media-preview-thumbnail,
        :host([${n.MEDIA_PREVIEW_IMAGE}]:hover) ::slotted(media-preview-thumbnail) {
          transition-delay: var(--media-preview-transition-delay-in, .25s);
          visibility: visible;
        }

        :host([${n.MEDIA_PREVIEW_TIME}]:hover) {
          --media-time-range-hover-display: block;
        }
      }

      media-preview-chapter-display,
      ::slotted(media-preview-chapter-display) {
        font-size: var(--media-font-size, 13px);
        line-height: 17px;
        min-width: 0;
        visibility: hidden;
        
        transition: min-width 0s, border-radius 0s, margin 0s, padding 0s, visibility 0s;
        transition-delay: calc(var(--media-preview-transition-delay-out, 0s) + var(--media-preview-transition-duration-out, .25s));
        background: var(--media-preview-chapter-background, var(--_preview-background));
        border-radius: var(--media-preview-chapter-border-radius,
          var(--media-preview-border-radius) var(--media-preview-border-radius)
          var(--media-preview-border-radius) var(--media-preview-border-radius));
        padding: var(--media-preview-chapter-padding, 3.5px 9px);
        margin: var(--media-preview-chapter-margin, 0 0 5px);
        text-shadow: var(--media-preview-chapter-text-shadow, 0 0 4px rgb(0 0 0 / .75));
      }

      :host([${n.MEDIA_PREVIEW_IMAGE}]) media-preview-chapter-display,
      :host([${n.MEDIA_PREVIEW_IMAGE}]) ::slotted(media-preview-chapter-display) {
        transition-delay: var(--media-preview-transition-delay-in, .25s);
        border-radius: var(--media-preview-chapter-border-radius, 0);
        padding: var(--media-preview-chapter-padding, 3.5px 9px 0);
        margin: var(--media-preview-chapter-margin, 0);
        min-width: 100%;
      }

      media-preview-chapter-display[${n.MEDIA_PREVIEW_CHAPTER}],
      ::slotted(media-preview-chapter-display[${n.MEDIA_PREVIEW_CHAPTER}]) {
        visibility: visible;
      }

      media-preview-chapter-display:not([aria-valuetext]),
      ::slotted(media-preview-chapter-display:not([aria-valuetext])) {
        display: none;
      }

      media-preview-time-display,
      ::slotted(media-preview-time-display),
      media-time-display,
      ::slotted(media-time-display) {
        font-size: var(--media-font-size, 13px);
        line-height: 17px;
        min-width: 0;
        
        transition: min-width 0s, border-radius 0s;
        transition-delay: calc(var(--media-preview-transition-delay-out, 0s) + var(--media-preview-transition-duration-out, .25s));
        background: var(--media-preview-time-background, var(--_preview-background));
        border-radius: var(--media-preview-time-border-radius,
          var(--media-preview-border-radius) var(--media-preview-border-radius)
          var(--media-preview-border-radius) var(--media-preview-border-radius));
        padding: var(--media-preview-time-padding, 3.5px 9px);
        margin: var(--media-preview-time-margin, 0);
        text-shadow: var(--media-preview-time-text-shadow, 0 0 4px rgb(0 0 0 / .75));
        transform: translateX(min(
          max(calc(50% - var(--_box-width) / 2),
          calc(var(--_box-shift, 0))),
          calc(var(--_box-width) / 2 - 50%)
        ));
      }

      :host([${n.MEDIA_PREVIEW_IMAGE}]) media-preview-time-display,
      :host([${n.MEDIA_PREVIEW_IMAGE}]) ::slotted(media-preview-time-display) {
        transition-delay: var(--media-preview-transition-delay-in, .25s);
        border-radius: var(--media-preview-time-border-radius,
          0 0 var(--media-preview-border-radius) var(--media-preview-border-radius));
        min-width: 100%;
      }

      :host([${n.MEDIA_PREVIEW_TIME}]:hover) {
        --media-time-range-hover-display: block;
      }

      [part~="arrow"],
      ::slotted([part~="arrow"]) {
        display: var(--media-box-arrow-display, inline-block);
        transform: translateX(min(
          max(calc(50% - var(--_box-width) / 2 + var(--media-box-arrow-offset)),
          calc(var(--_box-shift, 0))),
          calc(var(--_box-width) / 2 - 50% - var(--media-box-arrow-offset))
        ));
        
        border-color: transparent;
        border-top-color: var(--media-box-arrow-background, var(--_control-background));
        border-width: var(--media-box-arrow-border-width,
          var(--media-box-arrow-height, 5px) var(--media-box-arrow-width, 6px) 0);
        border-style: solid;
        justify-content: center;
        height: 0;
      }
    </style>
    <div id="preview-rail">
      <slot name="preview" part="box preview-box">
        <media-preview-thumbnail>
          <template shadowrootmode="${gs.shadowRootOptions.mode}">
            ${gs.getTemplateHTML({})}
          </template>
        </media-preview-thumbnail>
        <media-preview-chapter-display></media-preview-chapter-display>
        <media-preview-time-display></media-preview-time-display>
        <slot name="preview-arrow"><div part="arrow"></div></slot>
      </slot>
    </div>
    <div id="current-rail">
      <slot name="current" part="box current-box">
        
      </slot>
    </div>
  `}const Ri=(t,e=t.mediaCurrentTime)=>{const i=Number.isFinite(t.mediaSeekableStart)?t.mediaSeekableStart:0,a=Number.isFinite(t.mediaDuration)?t.mediaDuration:t.mediaSeekableEnd;if(Number.isNaN(a))return 0;const s=(e-i)/(a-i);return Math.max(0,Math.min(s,1))},vo=(t,e=t.range.valueAsNumber)=>{const i=Number.isFinite(t.mediaSeekableStart)?t.mediaSeekableStart:0,a=Number.isFinite(t.mediaDuration)?t.mediaDuration:t.mediaSeekableEnd;return Number.isNaN(a)?0:e*(a-i)+i};let Wa=class extends ot{constructor(){super(),q(this,Ts),q(this,Ea),q(this,va),q(this,fa),q(this,ys),q(this,pi),q(this,Ss),q(this,Mt,null),q(this,ze,void 0),q(this,ma,void 0),q(this,oi,void 0),q(this,pa,void 0),q(this,aa,void 0),q(this,hi,void 0),q(this,mi,void 0),q(this,Lt,void 0),q(this,wt,void 0),q(this,ti,()=>{he(this,Ts,mo).call(this)?x(this,ze).start():x(this,ze).stop()}),q(this,Is,a=>{this.dragging||(ks(a)&&(this.range.valueAsNumber=a),x(this,wt)||this.updateBar())}),this.shadowRoot.querySelector("#track").insertAdjacentHTML("afterbegin",'<div id="buffered" part="buffered"></div>'),ue(this,ma,this.shadowRoot.querySelectorAll('[part~="box"]')),ue(this,pa,this.shadowRoot.querySelector('[part~="preview-box"]')),ue(this,aa,this.shadowRoot.querySelector('[part~="current-box"]'));const i=getComputedStyle(this);ue(this,hi,parseInt(i.getPropertyValue("--media-box-padding-left"))),ue(this,mi,parseInt(i.getPropertyValue("--media-box-padding-right"))),ue(this,ze,new Yc(this.range,x(this,Is),60))}static get observedAttributes(){return[...super.observedAttributes,n.MEDIA_PAUSED,n.MEDIA_DURATION,n.MEDIA_SEEKABLE,n.MEDIA_CURRENT_TIME,n.MEDIA_PREVIEW_IMAGE,n.MEDIA_PREVIEW_TIME,n.MEDIA_PREVIEW_CHAPTER,n.MEDIA_BUFFERED,n.MEDIA_PLAYBACK_RATE,n.MEDIA_LOADING,n.MEDIA_ENDED]}connectedCallback(){var e;super.connectedCallback(),this.range.setAttribute("aria-label",f("seek")),x(this,ti).call(this),ue(this,Mt,this.getRootNode()),(e=x(this,Mt))==null||e.addEventListener("transitionstart",this)}disconnectedCallback(){var e;super.disconnectedCallback(),x(this,ze).stop(),(e=x(this,Mt))==null||e.removeEventListener("transitionstart",this),ue(this,Mt,null)}attributeChangedCallback(e,i,a){super.attributeChangedCallback(e,i,a),i!=a&&(e===n.MEDIA_CURRENT_TIME||e===n.MEDIA_PAUSED||e===n.MEDIA_ENDED||e===n.MEDIA_LOADING||e===n.MEDIA_DURATION||e===n.MEDIA_SEEKABLE?(x(this,ze).update({start:Ri(this),duration:this.mediaSeekableEnd-this.mediaSeekableStart,playbackRate:this.mediaPlaybackRate}),x(this,ti).call(this),Qc(this)):e===n.MEDIA_BUFFERED&&this.updateBufferedBar(),(e===n.MEDIA_DURATION||e===n.MEDIA_SEEKABLE)&&(this.mediaChaptersCues=x(this,Lt),this.updateBar()))}get mediaChaptersCues(){return x(this,Lt)}set mediaChaptersCues(e){var i;ue(this,Lt,e),this.updateSegments((i=x(this,Lt))==null?void 0:i.map(a=>({start:Ri(this,a.startTime),end:Ri(this,a.endTime)})))}get mediaPaused(){return M(this,n.MEDIA_PAUSED)}set mediaPaused(e){L(this,n.MEDIA_PAUSED,e)}get mediaLoading(){return M(this,n.MEDIA_LOADING)}set mediaLoading(e){L(this,n.MEDIA_LOADING,e)}get mediaDuration(){return H(this,n.MEDIA_DURATION)}set mediaDuration(e){j(this,n.MEDIA_DURATION,e)}get mediaCurrentTime(){return H(this,n.MEDIA_CURRENT_TIME)}set mediaCurrentTime(e){j(this,n.MEDIA_CURRENT_TIME,e)}get mediaPlaybackRate(){return H(this,n.MEDIA_PLAYBACK_RATE,1)}set mediaPlaybackRate(e){j(this,n.MEDIA_PLAYBACK_RATE,e)}get mediaBuffered(){const e=this.getAttribute(n.MEDIA_BUFFERED);return e?e.split(" ").map(i=>i.split(":").map(a=>+a)):[]}set mediaBuffered(e){if(!e){this.removeAttribute(n.MEDIA_BUFFERED);return}const i=e.map(a=>a.join(":")).join(" ");this.setAttribute(n.MEDIA_BUFFERED,i)}get mediaSeekable(){const e=this.getAttribute(n.MEDIA_SEEKABLE);if(e)return e.split(":").map(i=>+i)}set mediaSeekable(e){if(e==null){this.removeAttribute(n.MEDIA_SEEKABLE);return}this.setAttribute(n.MEDIA_SEEKABLE,e.join(":"))}get mediaSeekableEnd(){var e;const[,i=this.mediaDuration]=(e=this.mediaSeekable)!=null?e:[];return i}get mediaSeekableStart(){var e;const[i=0]=(e=this.mediaSeekable)!=null?e:[];return i}get mediaPreviewImage(){return B(this,n.MEDIA_PREVIEW_IMAGE)}set mediaPreviewImage(e){F(this,n.MEDIA_PREVIEW_IMAGE,e)}get mediaPreviewTime(){return H(this,n.MEDIA_PREVIEW_TIME)}set mediaPreviewTime(e){j(this,n.MEDIA_PREVIEW_TIME,e)}get mediaEnded(){return M(this,n.MEDIA_ENDED)}set mediaEnded(e){L(this,n.MEDIA_ENDED,e)}updateBar(){super.updateBar(),this.updateBufferedBar(),this.updateCurrentBox()}updateBufferedBar(){var e;const i=this.mediaBuffered;if(!i.length)return;let a;if(this.mediaEnded)a=1;else{const r=this.mediaCurrentTime,[,o=this.mediaSeekableStart]=(e=i.find(([d,c])=>d<=r&&r<=c))!=null?e:[];a=Ri(this,o)}const{style:s}=Q(this.shadowRoot,"#buffered");s.setProperty("width",`${a*100}%`)}updateCurrentBox(){if(!this.shadowRoot.querySelector('slot[name="current"]').assignedElements().length)return;const i=Q(this.shadowRoot,"#current-rail"),a=Q(this.shadowRoot,'[part~="current-box"]'),s=he(this,Ea,zs).call(this,x(this,aa)),r=he(this,va,Zs).call(this,s,this.range.valueAsNumber),o=he(this,fa,Xs).call(this,s,this.range.valueAsNumber);i.style.transform=`translateX(${r})`,i.style.setProperty("--_range-width",`${s.range.width}`),a.style.setProperty("--_box-shift",`${o}`),a.style.setProperty("--_box-width",`${s.box.width}px`),a.style.setProperty("visibility","initial")}handleEvent(e){switch(super.handleEvent(e),e.type){case"input":he(this,Ss,Eo).call(this);break;case"pointermove":he(this,ys,po).call(this,e);break;case"pointerup":x(this,wt)&&ue(this,wt,!1);break;case"pointerdown":ue(this,wt,!0);break;case"pointerleave":he(this,pi,_a).call(this,null);break;case"transitionstart":Nt(e.target,this)&&setTimeout(()=>x(this,ti).call(this),0);break}}};Mt=new WeakMap;ze=new WeakMap;ma=new WeakMap;oi=new WeakMap;pa=new WeakMap;aa=new WeakMap;hi=new WeakMap;mi=new WeakMap;Lt=new WeakMap;wt=new WeakMap;ti=new WeakMap;Ts=new WeakSet;mo=function(){return this.isConnected&&!this.mediaPaused&&!this.mediaLoading&&!this.mediaEnded&&this.mediaSeekableEnd>0&&gn(this)};Is=new WeakMap;Ea=new WeakSet;zs=function(t){var e;const a=((e=this.getAttribute("bounds")?Ei(this,`#${this.getAttribute("bounds")}`):this.parentElement)!=null?e:this).getBoundingClientRect(),s=this.range.getBoundingClientRect(),r=t.offsetWidth,o=-(s.left-a.left-r/2),d=a.right-s.left-r/2;return{box:{width:r,min:o,max:d},bounds:a,range:s}};va=new WeakSet;Zs=function(t,e){let i=`${e*100}%`;const{width:a,min:s,max:r}=t.box;if(!a)return i;if(Number.isNaN(s)||(i=`max(${`calc(1 / var(--_range-width) * 100 * ${s}% + var(--media-box-padding-left))`}, ${i})`),!Number.isNaN(r)){const d=`calc(1 / var(--_range-width) * 100 * ${r}% - var(--media-box-padding-right))`;i=`min(${i}, ${d})`}return i};fa=new WeakSet;Xs=function(t,e){const{width:i,min:a,max:s}=t.box,r=e*t.range.width;if(r<a+x(this,hi)){const o=t.range.left-t.bounds.left-x(this,hi);return`${r-i/2+o}px`}if(r>s-x(this,mi)){const o=t.bounds.right-t.range.right-x(this,mi);return`${r+i/2-o-t.range.width}px`}return 0};ys=new WeakSet;po=function(t){const e=[...x(this,ma)].some(I=>t.composedPath().includes(I));if(!this.dragging&&(e||!t.composedPath().includes(this))){he(this,pi,_a).call(this,null);return}const i=this.mediaSeekableEnd;if(!i)return;const a=Q(this.shadowRoot,"#preview-rail"),s=Q(this.shadowRoot,'[part~="preview-box"]'),r=he(this,Ea,zs).call(this,x(this,pa));let o=(t.clientX-r.range.left)/r.range.width;o=Math.max(0,Math.min(1,o));const d=he(this,va,Zs).call(this,r,o),c=he(this,fa,Xs).call(this,r,o);a.style.transform=`translateX(${d})`,a.style.setProperty("--_range-width",`${r.range.width}`),s.style.setProperty("--_box-shift",`${c}`),s.style.setProperty("--_box-width",`${r.box.width}px`);const y=Math.round(x(this,oi))-Math.round(o*i);Math.abs(y)<1&&o>.01&&o<.99||(ue(this,oi,o*i),he(this,pi,_a).call(this,x(this,oi)))};pi=new WeakSet;_a=function(t){this.dispatchEvent(new l.CustomEvent(p.MEDIA_PREVIEW_REQUEST,{composed:!0,bubbles:!0,detail:t}))};Ss=new WeakSet;Eo=function(){x(this,ze).stop();const t=vo(this);this.dispatchEvent(new l.CustomEvent(p.MEDIA_SEEK_REQUEST,{composed:!0,bubbles:!0,detail:t}))};Wa.shadowRootOptions={mode:"open"};Wa.getContainerTemplateHTML=zc;l.customElements.get("media-time-range")||l.customElements.define("media-time-range",Wa);var Zc=Wa,Xc=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},an=(t,e,i)=>(Xc(t,e,"read from private field"),i?i.call(t):e.get(t)),Jc=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},sa;const jc=1,eu=t=>t.mediaMuted?0:t.mediaVolume,tu=t=>`${Math.round(t*100)}%`;let fo=class extends ot{constructor(){super(...arguments),Jc(this,sa,()=>{const e=this.range.value,i=new l.CustomEvent(p.MEDIA_VOLUME_REQUEST,{composed:!0,bubbles:!0,detail:e});this.dispatchEvent(i)})}static get observedAttributes(){return[...super.observedAttributes,n.MEDIA_VOLUME,n.MEDIA_MUTED,n.MEDIA_VOLUME_UNAVAILABLE]}connectedCallback(){super.connectedCallback(),this.range.setAttribute("aria-label",f("volume")),this.range.addEventListener("input",an(this,sa))}disconnectedCallback(){this.range.removeEventListener("input",an(this,sa)),super.disconnectedCallback()}attributeChangedCallback(e,i,a){super.attributeChangedCallback(e,i,a),(e===n.MEDIA_VOLUME||e===n.MEDIA_MUTED)&&(this.range.valueAsNumber=eu(this),this.range.setAttribute("aria-valuetext",tu(this.range.valueAsNumber)),this.updateBar())}get mediaVolume(){return H(this,n.MEDIA_VOLUME,jc)}set mediaVolume(e){j(this,n.MEDIA_VOLUME,e)}get mediaMuted(){return M(this,n.MEDIA_MUTED)}set mediaMuted(e){L(this,n.MEDIA_MUTED,e)}get mediaVolumeUnavailable(){return B(this,n.MEDIA_VOLUME_UNAVAILABLE)}set mediaVolumeUnavailable(e){F(this,n.MEDIA_VOLUME_UNAVAILABLE,e)}};sa=new WeakMap;l.customElements.get("media-volume-range")||l.customElements.define("media-volume-range",fo);var iu=fo;function au(t){return`
      <style>
        :host {
          min-width: 4ch;
          padding: var(--media-button-padding, var(--media-control-padding, 10px 5px));
          width: 100%;
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 1rem;
          font-weight: var(--media-button-font-weight, normal);
        }

        #checked-indicator {
          display: none;
        }

        :host([${n.MEDIA_LOOP}]) #checked-indicator {
          display: block;
        }
      </style>
      
      <span id="icon">
     </span>

      <div id="checked-indicator">
        <svg aria-hidden="true" viewBox="0 1 24 24" part="checked-indicator indicator">
          <path d="m10 15.17 9.193-9.191 1.414 1.414-10.606 10.606-6.364-6.364 1.414-1.414 4.95 4.95Z"/>
        </svg>
      </div>
    `}function su(){return f("Loop")}class Ba extends ee{constructor(){super(...arguments),this.container=null}static get observedAttributes(){return[...super.observedAttributes,n.MEDIA_LOOP]}connectedCallback(){var e;super.connectedCallback(),this.container=((e=this.shadowRoot)==null?void 0:e.querySelector("#icon"))||null,this.container&&(this.container.textContent=f("Loop"))}attributeChangedCallback(e,i,a){super.attributeChangedCallback(e,i,a),e===n.MEDIA_LOOP&&this.container&&this.setAttribute("aria-checked",this.mediaLoop?"true":"false")}get mediaLoop(){return M(this,n.MEDIA_LOOP)}set mediaLoop(e){L(this,n.MEDIA_LOOP,e)}handleClick(){const e=!this.mediaLoop,i=new l.CustomEvent(p.MEDIA_LOOP_REQUEST,{composed:!0,bubbles:!0,detail:e});this.dispatchEvent(i)}}Ba.getSlotTemplateHTML=au;Ba.getTooltipContentHTML=su;l.customElements.get("media-loop-button")||l.customElements.define("media-loop-button",Ba);var ru=Ba;function C(t){if(typeof t=="boolean")return t?"":void 0;if(typeof t=="function")return;const e=i=>typeof i=="string"||typeof i=="number"||typeof i=="boolean";if(Array.isArray(t)&&t.every(e))return t.join(" ");if(!(typeof t=="object"&&t!==null))return t}D({tagName:"media-gesture-receiver",elementClass:za,react:R,toAttributeValue:C,defaultProps:{suppressHydrationWarning:!0}});D({tagName:"media-container",elementClass:rl,react:R,toAttributeValue:C,defaultProps:{suppressHydrationWarning:!0}});const nu=D({tagName:"media-controller",elementClass:Fl,react:R,toAttributeValue:C,defaultProps:{suppressHydrationWarning:!0}});D({tagName:"media-tooltip",elementClass:ss,react:R,toAttributeValue:C,defaultProps:{suppressHydrationWarning:!0}});D({tagName:"media-chrome-button",elementClass:ql,react:R,toAttributeValue:C,defaultProps:{suppressHydrationWarning:!0}});D({tagName:"media-airplay-button",elementClass:zl,react:R,toAttributeValue:C,defaultProps:{suppressHydrationWarning:!0}});D({tagName:"media-captions-button",elementClass:ed,react:R,toAttributeValue:C,defaultProps:{suppressHydrationWarning:!0}});D({tagName:"media-cast-button",elementClass:rd,react:R,toAttributeValue:C,defaultProps:{suppressHydrationWarning:!0}});D({tagName:"media-chrome-dialog",elementClass:ld,react:R,toAttributeValue:C,defaultProps:{suppressHydrationWarning:!0}});D({tagName:"media-chrome-range",elementClass:ud,react:R,toAttributeValue:C,defaultProps:{suppressHydrationWarning:!0}});const sn=D({tagName:"media-control-bar",elementClass:pd,react:R,toAttributeValue:C,defaultProps:{suppressHydrationWarning:!0}});D({tagName:"media-text-display",elementClass:_d,react:R,toAttributeValue:C,defaultProps:{suppressHydrationWarning:!0}});D({tagName:"media-duration-display",elementClass:Td,react:R,toAttributeValue:C,defaultProps:{suppressHydrationWarning:!0}});D({tagName:"media-error-dialog",elementClass:Rd,react:R,toAttributeValue:C,defaultProps:{suppressHydrationWarning:!0}});D({tagName:"media-keyboard-shortcuts-dialog",elementClass:Od,react:R,toAttributeValue:C,defaultProps:{suppressHydrationWarning:!0}});const ou=D({tagName:"media-fullscreen-button",elementClass:Bd,react:R,toAttributeValue:C,defaultProps:{suppressHydrationWarning:!0}});D({tagName:"media-live-button",elementClass:Yd,react:R,toAttributeValue:C,defaultProps:{suppressHydrationWarning:!0}});D({tagName:"media-loading-indicator",elementClass:Zd,react:R,toAttributeValue:C,defaultProps:{suppressHydrationWarning:!0}});const lu=D({tagName:"media-mute-button",elementClass:tc,react:R,toAttributeValue:C,defaultProps:{suppressHydrationWarning:!0}});D({tagName:"media-pip-button",elementClass:sc,react:R,toAttributeValue:C,defaultProps:{suppressHydrationWarning:!0}});const du=D({tagName:"media-playback-rate-button",elementClass:cc,react:R,toAttributeValue:C,defaultProps:{suppressHydrationWarning:!0}}),cu=D({tagName:"media-play-button",elementClass:Ec,react:R,toAttributeValue:C,defaultProps:{suppressHydrationWarning:!0}});D({tagName:"media-poster-image",elementClass:gc,react:R,toAttributeValue:C,defaultProps:{suppressHydrationWarning:!0}});D({tagName:"media-preview-chapter-display",elementClass:Ic,react:R,toAttributeValue:C,defaultProps:{suppressHydrationWarning:!0}});D({tagName:"media-preview-thumbnail",elementClass:gs,react:R,toAttributeValue:C,defaultProps:{suppressHydrationWarning:!0}});D({tagName:"media-preview-time-display",elementClass:Lc,react:R,toAttributeValue:C,defaultProps:{suppressHydrationWarning:!0}});D({tagName:"media-seek-backward-button",elementClass:Oc,react:R,toAttributeValue:C,defaultProps:{suppressHydrationWarning:!0}});D({tagName:"media-seek-forward-button",elementClass:Fc,react:R,toAttributeValue:C,defaultProps:{suppressHydrationWarning:!0}});const uu=D({tagName:"media-time-display",elementClass:Gc,react:R,toAttributeValue:C,defaultProps:{suppressHydrationWarning:!0}}),hu=D({tagName:"media-time-range",elementClass:Zc,react:R,toAttributeValue:C,defaultProps:{suppressHydrationWarning:!0}}),mu=D({tagName:"media-volume-range",elementClass:iu,react:R,toAttributeValue:C,defaultProps:{suppressHydrationWarning:!0}});D({tagName:"media-loop-button",elementClass:ru,react:R,toAttributeValue:C,defaultProps:{suppressHydrationWarning:!0}});const pu={"--media-primary-color":"white","--media-secondary-color":"transparent","--media-control-background":"transparent","--media-control-hover-background":"rgb(0 0 0 / 18%)","--media-range-track-background":"rgb(255 255 255 / 50%)","--media-range-bar-color":"white","--media-font-family":"var(--font-sans)"};function Eu(t){return Y.jsxs(nu,{"aria-label":`Video player: ${t.title}`,className:Ka("block w-full overflow-hidden rounded-md bg-black text-white [--media-control-padding:2px] [--media-font-size:10px] [--media-icon-size:14px] sm:[--media-control-padding:4px] sm:[--media-font-size:12px] sm:[--media-icon-size:20px]",t.className),noHotkeys:!0,style:pu,children:[Y.jsx("video",{...t.videoProps,"aria-label":t.title,className:"block aspect-video max-h-[75dvh] w-full bg-black object-contain",playsInline:!0,preload:"none",ref:t.videoRef,slot:"media"}),Y.jsx(sn,{className:Ka("h-4 w-full bg-transparent px-2 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] sm:h-5 sm:px-3",t.idle&&"hidden"),children:Y.jsx(hu,{className:"h-4 w-full sm:h-5"})}),Y.jsxs(sn,{className:Ka("flex w-full items-center gap-1 bg-transparent px-2 pb-1 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] sm:gap-2 sm:px-3 sm:pb-2",t.idle&&"hidden"),children:[Y.jsx(cu,{className:"rounded-md"}),Y.jsx(lu,{className:"rounded-md"}),Y.jsx(mu,{className:"hidden max-w-20 sm:block"}),Y.jsx(uu,{showDuration:!0}),Y.jsx("span",{className:"flex-1"}),!t.compactControls&&Y.jsx(du,{className:"rounded-md"}),!t.compactControls&&Y.jsx(ou,{className:"rounded-md"})]})]})}const ii={all:["space-files"],space:t=>[...ii.all,t],folder:(t,e,i="active",a="artifact")=>[...ii.space(t),"folder",i,a,e],content:(t,e,i)=>[...ii.space(t),"content",e,i],revisions:(t,e)=>[...ii.space(t),"revisions",e]};let Et=null;function Ru(t){const e=Oe.useContext(ko),[i,a]=Oe.useState(!1),[s,r]=Oe.useState(0),o=Oe.useMemo(()=>{if(e){if(t.localPreviewUrl)return Ir(e).find(t.localPreviewUrl);if(t.target)return e.getQueryData(ii.content(t.target.spaceId,t.target.fileId,t.target.revision))?.mediaPreview}},[e,t.localPreviewUrl,t.target]),d=t.target&&!t.isLocal?Mo(t.target):null,c=o?o.getSnapshot():t.localPreviewUrl??d,y=Oe.useRef(t.onRevoked);y.current=t.onRevoked;const I=Oe.useRef(t.onReady);I.current=t.onReady;const g=Oe.useRef(t.target);g.current=t.target;const E=Oe.useMemo(()=>({source:c,attempt:s}),[c,s]);return Oe.useEffect(()=>{const m=E.source,h=t.videoRef.current;if(!(h&&m))return;let v=!1;const A=()=>{h.pause(),h.removeAttribute("src"),h.load(),y.current()},T=o?.subscribe(()=>{o.getSnapshot()||A()}),S=e?Ir(e).subscribeRevocation(ae=>{const fi=g.current?.spaceId??o?.spaceId;(ae.spaceId===void 0||ae.spaceId===fi)&&(ae.fileId===void 0||ae.fileId===g.current?.fileId)&&A()}):void 0,w={...t.snapshot.current},N=()=>{v||(h.currentTime=Math.min(w.time,Number.isFinite(h.duration)?Math.max(0,h.duration-.01):w.time),h.playbackRate=w.rate,h.volume=w.volume,h.muted=w.muted)},z=()=>{if(document.visibilityState==="hidden"){h.pause();return}Et&&Et!==h&&Et.pause(),Et=h},V=()=>{document.visibilityState==="hidden"&&h.pause()},de=()=>{v||a(!0)},Fe=()=>I.current?.();return h.addEventListener("loadedmetadata",N,{once:!0}),h.addEventListener("loadeddata",Fe,{once:!0}),h.addEventListener("play",z),h.addEventListener("error",de),document.addEventListener("visibilitychange",V),h.src=m,h.preload="metadata",h.load(),w.playing&&document.visibilityState!=="hidden"&&h.play().catch(ae=>{v||ae instanceof DOMException&&(ae.name==="NotAllowedError"||ae.name==="AbortError")||a(!0)}),()=>{v=!0,t.snapshot.current={time:h.currentTime,rate:h.playbackRate,volume:h.volume,muted:h.muted,playing:t.transferring.current&&!h.paused&&!h.ended},t.transferring.current=!1,h.pause(),h.removeEventListener("loadedmetadata",N),h.removeEventListener("loadeddata",Fe),h.removeEventListener("play",z),h.removeEventListener("error",de),document.removeEventListener("visibilitychange",V),Et===h&&(Et=null),h.removeAttribute("src"),h.load(),T?.(),S?.()}},[E,e,o,t.videoRef,t.snapshot,t.transferring]),Y.jsxs("div",{children:[Y.jsx(Eu,{compactControls:t.compactControls,idle:t.idle,title:t.fileName,videoProps:{},videoRef:t.videoRef}),(i||!c)&&Y.jsxs("div",{className:"space-y-2 border-border border-t p-4 text-sm",role:"alert",children:[Y.jsx("p",{children:"This video couldn't be played. Its format may not be supported, or access may have changed."}),Y.jsxs("div",{className:"flex gap-4 text-xs",children:[Y.jsx("button",{className:"font-medium underline underline-offset-4",onClick:()=>{a(!1),r(m=>m+1)},type:"button",children:"Retry"}),c&&Y.jsx("a",{className:"font-medium underline underline-offset-4",download:t.fileName,href:c,children:"Download original"})]})]})]})}export{Ru as SpaceVideoPlayback};
