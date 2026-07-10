import{A as e,B as t,C as n,Cn as r,F as i,G as a,J as o,L as s,N as c,R as l,T as u,Y as d,Z as f,_ as p,f as m,g as h,h as g,ht as _,j as v,l as y,ln as b,n as x,q as S,t as C,tt as w,v as T,vt as E,w as D,x as O,xn as k,y as A,yn as j,z as M}from"./button-CzVenRui.js";import{A as N,D as ee,E as te,S as P,c as ne,d as re,f as ie,h as ae,l as oe,m as se,o as ce,p as le,s as ue,u as de,v as fe,x as F}from"./index-nMCG9o6e.js";import{a as I,i as L,n as pe,o as R,r as z,s as B,t as me,u as V}from"./StatusTag-DLD3dYcA.js";import{t as he}from"./toolbar-CrJMnWzE.js";var H=y.extend({name:`togglebutton`,style:`
    .p-togglebutton {
        display: inline-flex;
        cursor: pointer;
        user-select: none;
        overflow: hidden;
        position: relative;
        color: dt('togglebutton.color');
        background: dt('togglebutton.background');
        border: 1px solid dt('togglebutton.border.color');
        padding: dt('togglebutton.padding');
        font-size: 1rem;
        font-family: inherit;
        font-feature-settings: inherit;
        transition:
            background dt('togglebutton.transition.duration'),
            color dt('togglebutton.transition.duration'),
            border-color dt('togglebutton.transition.duration'),
            outline-color dt('togglebutton.transition.duration'),
            box-shadow dt('togglebutton.transition.duration');
        border-radius: dt('togglebutton.border.radius');
        outline-color: transparent;
        font-weight: dt('togglebutton.font.weight');
    }

    .p-togglebutton-content {
        display: inline-flex;
        flex: 1 1 auto;
        align-items: center;
        justify-content: center;
        gap: dt('togglebutton.gap');
        padding: dt('togglebutton.content.padding');
        background: transparent;
        border-radius: dt('togglebutton.content.border.radius');
        transition:
            background dt('togglebutton.transition.duration'),
            color dt('togglebutton.transition.duration'),
            border-color dt('togglebutton.transition.duration'),
            outline-color dt('togglebutton.transition.duration'),
            box-shadow dt('togglebutton.transition.duration');
    }

    .p-togglebutton:not(:disabled):not(.p-togglebutton-checked):hover {
        background: dt('togglebutton.hover.background');
        color: dt('togglebutton.hover.color');
    }

    .p-togglebutton.p-togglebutton-checked {
        background: dt('togglebutton.checked.background');
        border-color: dt('togglebutton.checked.border.color');
        color: dt('togglebutton.checked.color');
    }

    .p-togglebutton-checked .p-togglebutton-content {
        background: dt('togglebutton.content.checked.background');
        box-shadow: dt('togglebutton.content.checked.shadow');
    }

    .p-togglebutton:focus-visible {
        box-shadow: dt('togglebutton.focus.ring.shadow');
        outline: dt('togglebutton.focus.ring.width') dt('togglebutton.focus.ring.style') dt('togglebutton.focus.ring.color');
        outline-offset: dt('togglebutton.focus.ring.offset');
    }

    .p-togglebutton.p-invalid {
        border-color: dt('togglebutton.invalid.border.color');
    }

    .p-togglebutton:disabled {
        opacity: 1;
        cursor: default;
        background: dt('togglebutton.disabled.background');
        border-color: dt('togglebutton.disabled.border.color');
        color: dt('togglebutton.disabled.color');
    }

    .p-togglebutton-label,
    .p-togglebutton-icon {
        position: relative;
        transition: none;
    }

    .p-togglebutton-icon {
        color: dt('togglebutton.icon.color');
    }

    .p-togglebutton:not(:disabled):not(.p-togglebutton-checked):hover .p-togglebutton-icon {
        color: dt('togglebutton.icon.hover.color');
    }

    .p-togglebutton.p-togglebutton-checked .p-togglebutton-icon {
        color: dt('togglebutton.icon.checked.color');
    }

    .p-togglebutton:disabled .p-togglebutton-icon {
        color: dt('togglebutton.icon.disabled.color');
    }

    .p-togglebutton-sm {
        padding: dt('togglebutton.sm.padding');
        font-size: dt('togglebutton.sm.font.size');
    }

    .p-togglebutton-sm .p-togglebutton-content {
        padding: dt('togglebutton.content.sm.padding');
    }

    .p-togglebutton-lg {
        padding: dt('togglebutton.lg.padding');
        font-size: dt('togglebutton.lg.font.size');
    }

    .p-togglebutton-lg .p-togglebutton-content {
        padding: dt('togglebutton.content.lg.padding');
    }

    .p-togglebutton-fluid {
        width: 100%;
    }
`,classes:{root:function(e){var t=e.instance,n=e.props;return[`p-togglebutton p-component`,{"p-togglebutton-checked":t.active,"p-invalid":t.$invalid,"p-togglebutton-fluid":n.fluid,"p-togglebutton-sm p-inputfield-sm":n.size===`small`,"p-togglebutton-lg p-inputfield-lg":n.size===`large`}]},content:`p-togglebutton-content`,icon:`p-togglebutton-icon`,label:`p-togglebutton-label`}}),U={name:`BaseToggleButton`,extends:B,props:{onIcon:String,offIcon:String,onLabel:{type:String,default:`Yes`},offLabel:{type:String,default:`No`},readonly:{type:Boolean,default:!1},tabindex:{type:Number,default:null},ariaLabelledby:{type:String,default:null},ariaLabel:{type:String,default:null},size:{type:String,default:null},fluid:{type:Boolean,default:null}},style:H,provide:function(){return{$pcToggleButton:this,$parentInstance:this}}};function W(e){"@babel/helpers - typeof";return W=typeof Symbol==`function`&&typeof Symbol.iterator==`symbol`?function(e){return typeof e}:function(e){return e&&typeof Symbol==`function`&&e.constructor===Symbol&&e!==Symbol.prototype?`symbol`:typeof e},W(e)}function G(e,t,n){return(t=K(t))in e?Object.defineProperty(e,t,{value:n,enumerable:!0,configurable:!0,writable:!0}):e[t]=n,e}function K(e){var t=q(e,`string`);return W(t)==`symbol`?t:t+``}function q(e,t){if(W(e)!=`object`||!e)return e;var n=e[Symbol.toPrimitive];if(n!==void 0){var r=n.call(e,t);if(W(r)!=`object`)return r;throw TypeError(`@@toPrimitive must return a primitive value.`)}return(t===`string`?String:Number)(e)}var J={name:`ToggleButton`,extends:U,inheritAttrs:!1,emits:[`change`],methods:{getPTOptions:function(e){return(e===`root`?this.ptmi:this.ptm)(e,{context:{active:this.active,disabled:this.disabled}})},onChange:function(e){!this.disabled&&!this.readonly&&(this.writeValue(!this.d_value,e),this.$emit(`change`,e))},onBlur:function(e){var t,n;(t=(n=this.formField).onBlur)==null||t.call(n,e)}},computed:{active:function(){return this.d_value===!0},hasLabel:function(){return r(this.onLabel)&&r(this.offLabel)},label:function(){return this.hasLabel?this.d_value?this.onLabel:this.offLabel:`\xA0`},dataP:function(){return b(G({checked:this.active,invalid:this.$invalid},this.size,this.size))}},directives:{ripple:x}},Y=[`tabindex`,`disabled`,`aria-pressed`,`aria-label`,`aria-labelledby`,`data-p-checked`,`data-p-disabled`,`data-p`],ge=[`data-p`];function _e(e,n,r,a,o,s){var c=t(`ripple`);return d((i(),A(`button`,v({type:`button`,class:e.cx(`root`),tabindex:e.tabindex,disabled:e.disabled,"aria-pressed":e.d_value,onClick:n[0]||=function(){return s.onChange&&s.onChange.apply(s,arguments)},onBlur:n[1]||=function(){return s.onBlur&&s.onBlur.apply(s,arguments)}},s.getPTOptions(`root`),{"aria-label":e.ariaLabel,"aria-labelledby":e.ariaLabelledby,"data-p-checked":s.active,"data-p-disabled":e.disabled,"data-p":s.dataP}),[h(`span`,v({class:e.cx(`content`)},s.getPTOptions(`content`),{"data-p":s.dataP}),[l(e.$slots,`default`,{},function(){return[l(e.$slots,`icon`,{value:e.d_value,class:_(e.cx(`icon`))},function(){return[e.onIcon||e.offIcon?(i(),A(`span`,v({key:0,class:[e.cx(`icon`),e.d_value?e.onIcon:e.offIcon]},s.getPTOptions(`icon`)),null,16)):T(``,!0)]}),h(`span`,v({class:e.cx(`label`)},s.getPTOptions(`label`)),E(s.label),17)]})],16,ge)],16,Y)),[[c]])}J.render=_e;var ve=y.extend({name:`selectbutton`,style:`
    .p-selectbutton {
        display: inline-flex;
        user-select: none;
        vertical-align: bottom;
        outline-color: transparent;
        border-radius: dt('selectbutton.border.radius');
    }

    .p-selectbutton .p-togglebutton {
        border-radius: 0;
        border-width: 1px 1px 1px 0;
    }

    .p-selectbutton .p-togglebutton:focus-visible {
        position: relative;
        z-index: 1;
    }

    .p-selectbutton .p-togglebutton:first-child {
        border-inline-start-width: 1px;
        border-start-start-radius: dt('selectbutton.border.radius');
        border-end-start-radius: dt('selectbutton.border.radius');
    }

    .p-selectbutton .p-togglebutton:last-child {
        border-start-end-radius: dt('selectbutton.border.radius');
        border-end-end-radius: dt('selectbutton.border.radius');
    }

    .p-selectbutton.p-invalid {
        outline: 1px solid dt('selectbutton.invalid.border.color');
        outline-offset: 0;
    }

    .p-selectbutton-fluid {
        width: 100%;
    }
    
    .p-selectbutton-fluid .p-togglebutton {
        flex: 1 1 0;
    }
`,classes:{root:function(e){var t=e.props;return[`p-selectbutton p-component`,{"p-invalid":e.instance.$invalid,"p-selectbutton-fluid":t.fluid}]}}}),ye={name:`BaseSelectButton`,extends:B,props:{options:Array,optionLabel:null,optionValue:null,optionDisabled:null,multiple:Boolean,allowEmpty:{type:Boolean,default:!0},dataKey:null,ariaLabelledby:{type:String,default:null},size:{type:String,default:null},fluid:{type:Boolean,default:null}},style:ve,provide:function(){return{$pcSelectButton:this,$parentInstance:this}}};function be(e,t){var n=typeof Symbol<`u`&&e[Symbol.iterator]||e[`@@iterator`];if(!n){if(Array.isArray(e)||(n=X(e))||t){n&&(e=n);var r=0,i=function(){};return{s:i,n:function(){return r>=e.length?{done:!0}:{done:!1,value:e[r++]}},e:function(e){throw e},f:i}}throw TypeError(`Invalid attempt to iterate non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`)}var a,o=!0,s=!1;return{s:function(){n=n.call(e)},n:function(){var e=n.next();return o=e.done,e},e:function(e){s=!0,a=e},f:function(){try{o||n.return==null||n.return()}finally{if(s)throw a}}}}function xe(e){return Ce(e)||Z(e)||X(e)||Se()}function Se(){throw TypeError(`Invalid attempt to spread non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`)}function X(e,t){if(e){if(typeof e==`string`)return we(e,t);var n={}.toString.call(e).slice(8,-1);return n===`Object`&&e.constructor&&(n=e.constructor.name),n===`Map`||n===`Set`?Array.from(e):n===`Arguments`||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)?we(e,t):void 0}}function Z(e){if(typeof Symbol<`u`&&e[Symbol.iterator]!=null||e[`@@iterator`]!=null)return Array.from(e)}function Ce(e){if(Array.isArray(e))return we(e)}function we(e,t){(t==null||t>e.length)&&(t=e.length);for(var n=0,r=Array(t);n<t;n++)r[n]=e[n];return r}var Te={name:`SelectButton`,extends:ye,inheritAttrs:!1,emits:[`change`],methods:{getOptionLabel:function(e){return this.optionLabel?k(e,this.optionLabel):e},getOptionValue:function(e){return this.optionValue?k(e,this.optionValue):e},getOptionRenderKey:function(e){return this.dataKey?k(e,this.dataKey):this.getOptionLabel(e)},isOptionDisabled:function(e){return this.optionDisabled?k(e,this.optionDisabled):!1},isOptionReadonly:function(e){if(this.allowEmpty)return!1;var t=this.isSelected(e);return this.multiple?t&&this.d_value.length===1:t},onOptionSelect:function(e,t,n){var r=this;if(!(this.disabled||this.isOptionDisabled(t)||this.isOptionReadonly(t))){var i=this.isSelected(t),a=this.getOptionValue(t),o;if(this.multiple)if(i){if(o=this.d_value.filter(function(e){return!j(e,a,r.equalityKey)}),!this.allowEmpty&&o.length===0)return}else o=this.d_value?[].concat(xe(this.d_value),[a]):[a];else{if(i&&!this.allowEmpty)return;o=i?null:a}this.writeValue(o,e),this.$emit(`change`,{originalEvent:e,value:o})}},isSelected:function(e){var t=!1,n=this.getOptionValue(e);if(this.multiple){if(this.d_value){var r=be(this.d_value),i;try{for(r.s();!(i=r.n()).done;){var a=i.value;if(j(a,n,this.equalityKey)){t=!0;break}}}catch(e){r.e(e)}finally{r.f()}}}else t=j(this.d_value,n,this.equalityKey);return t}},computed:{equalityKey:function(){return this.optionValue?null:this.dataKey},dataP:function(){return b({invalid:this.$invalid})}},directives:{ripple:x},components:{ToggleButton:J}},Ee=[`aria-labelledby`,`data-p`];function De(e,t,n,r,a,c){var u=M(`ToggleButton`);return i(),A(`div`,v({class:e.cx(`root`),role:`group`,"aria-labelledby":e.ariaLabelledby},e.ptmi(`root`),{"data-p":c.dataP}),[(i(!0),A(m,null,s(e.options,function(t,n){return i(),p(u,{key:c.getOptionRenderKey(t),modelValue:c.isSelected(t),onLabel:c.getOptionLabel(t),offLabel:c.getOptionLabel(t),disabled:e.disabled||c.isOptionDisabled(t),unstyled:e.unstyled,size:e.size,readonly:c.isOptionReadonly(t),onChange:function(e){return c.onOptionSelect(e,t,n)},pt:e.ptm(`pcToggleButton`)},O({_:2},[e.$slots.option?{name:`default`,fn:o(function(){return[l(e.$slots,`option`,{option:t,index:n},function(){return[h(`span`,v({ref_for:!0},e.ptm(`pcToggleButton`).label),E(c.getOptionLabel(t)),17)]})]}),key:`0`}:void 0]),1032,[`modelValue`,`onLabel`,`offLabel`,`disabled`,`unstyled`,`size`,`readonly`,`onChange`,`pt`])}),128))],16,Ee)}Te.render=De;var Oe={class:`credential-panel`},ke={class:`connection-details`},Ae={key:0},je={key:1},Q={class:`secret-value`},Me={key:1,class:`public-client-note`},Ne=u({__name:`ApplicationCredentialDetails`,props:{result:{},rotated:{type:Boolean,default:!1}},emits:[`copy`],setup(e){return(t,r)=>(i(),A(`div`,Oe,[e.result.credentialDelivery.kind===`already_delivered`?(i(),p(w(F),{key:0,severity:`error`,closable:!1},{default:o(()=>[...r[3]||=[n(` 该幂等请求已经成功创建应用，Client Secret 只在首次响应中交付，当前不会再次返回。 如果首次响应丢失，请回到应用列表轮换密钥；列表中的当前版本可用于安全重试。 `,-1)]]),_:1})):e.result.credentialDelivery.credential.kind===`none`?(i(),p(w(F),{key:1,severity:`info`,closable:!1},{default:o(()=>[...r[4]||=[n(` 公共客户端不会生成 Client Secret，请使用下方连接参数和 PKCE S256 接入。 `,-1)]]),_:1})):(i(),p(w(F),{key:2,severity:`warn`,closable:!1},{default:o(()=>[e.rotated?(i(),A(m,{key:0},[n(` 旧 Client Secret 已立即失效。新凭据只显示这一次，请立即保存到安全的密钥管理系统。 `)],64)):(i(),A(m,{key:1},[n(` 一次性凭据只会显示这一次。请立即复制并保存到安全的密钥管理系统，关闭后无法再次查看。 `)],64))]),_:1})),h(`dl`,ke,[r[6]||=h(`dt`,null,`Issuer`,-1),h(`dd`,null,[h(`code`,null,E(e.result.connection.issuer),1),D(w(C),{icon:`pi pi-copy`,text:``,rounded:``,severity:`secondary`,"aria-label":`复制 Issuer`,onClick:r[0]||=n=>t.$emit(`copy`,e.result.connection.issuer,`Issuer`)})]),r[7]||=h(`dt`,null,`Client ID`,-1),h(`dd`,null,[h(`code`,null,E(e.result.connection.clientId),1),D(w(C),{icon:`pi pi-copy`,text:``,rounded:``,severity:`secondary`,"aria-label":`复制 Client ID`,onClick:r[1]||=n=>t.$emit(`copy`,e.result.connection.clientId,`Client ID`)})]),r[8]||=h(`dt`,null,`Client Secret`,-1),e.result.credentialDelivery.kind===`already_delivered`?(i(),A(`dd`,Ae,[...r[5]||=[h(`span`,{class:`public-client-note`},`已在首次响应中交付，本次不再显示`,-1)]])):(i(),A(`dd`,je,[e.result.credentialDelivery.credential.kind===`client_secret`?(i(),A(m,{key:0},[h(`code`,Q,E(e.result.credentialDelivery.credential.clientSecret),1),D(w(C),{icon:`pi pi-copy`,label:`复制密钥`,size:`small`,severity:`danger`,outlined:``,onClick:r[2]||=n=>t.$emit(`copy`,e.result.credentialDelivery.credential.clientSecret,`Client Secret`)})],64)):(i(),A(`span`,Me,`公共客户端不使用 Client Secret`))])),r[9]||=h(`dt`,null,`Redirect URI`,-1),h(`dd`,null,[h(`code`,null,E(e.result.connection.redirectUris.join(`
`)),1)]),r[10]||=h(`dt`,null,`Scopes`,-1),h(`dd`,null,[h(`code`,null,E(e.result.connection.scopes.join(` `)),1)])])]))}}),Pe=y.extend({name:`textarea`,style:`
    .p-textarea {
        font-family: inherit;
        font-feature-settings: inherit;
        font-size: 1rem;
        color: dt('textarea.color');
        background: dt('textarea.background');
        padding-block: dt('textarea.padding.y');
        padding-inline: dt('textarea.padding.x');
        border: 1px solid dt('textarea.border.color');
        transition:
            background dt('textarea.transition.duration'),
            color dt('textarea.transition.duration'),
            border-color dt('textarea.transition.duration'),
            outline-color dt('textarea.transition.duration'),
            box-shadow dt('textarea.transition.duration');
        appearance: none;
        border-radius: dt('textarea.border.radius');
        outline-color: transparent;
        box-shadow: dt('textarea.shadow');
    }

    .p-textarea:enabled:hover {
        border-color: dt('textarea.hover.border.color');
    }

    .p-textarea:enabled:focus {
        border-color: dt('textarea.focus.border.color');
        box-shadow: dt('textarea.focus.ring.shadow');
        outline: dt('textarea.focus.ring.width') dt('textarea.focus.ring.style') dt('textarea.focus.ring.color');
        outline-offset: dt('textarea.focus.ring.offset');
    }

    .p-textarea.p-invalid {
        border-color: dt('textarea.invalid.border.color');
    }

    .p-textarea.p-variant-filled {
        background: dt('textarea.filled.background');
    }

    .p-textarea.p-variant-filled:enabled:hover {
        background: dt('textarea.filled.hover.background');
    }

    .p-textarea.p-variant-filled:enabled:focus {
        background: dt('textarea.filled.focus.background');
    }

    .p-textarea:disabled {
        opacity: 1;
        background: dt('textarea.disabled.background');
        color: dt('textarea.disabled.color');
    }

    .p-textarea::placeholder {
        color: dt('textarea.placeholder.color');
    }

    .p-textarea.p-invalid::placeholder {
        color: dt('textarea.invalid.placeholder.color');
    }

    .p-textarea-fluid {
        width: 100%;
    }

    .p-textarea-resizable {
        overflow: hidden;
        resize: none;
    }

    .p-textarea-sm {
        font-size: dt('textarea.sm.font.size');
        padding-block: dt('textarea.sm.padding.y');
        padding-inline: dt('textarea.sm.padding.x');
    }

    .p-textarea-lg {
        font-size: dt('textarea.lg.font.size');
        padding-block: dt('textarea.lg.padding.y');
        padding-inline: dt('textarea.lg.padding.x');
    }
`,classes:{root:function(e){var t=e.instance,n=e.props;return[`p-textarea p-component`,{"p-filled":t.$filled,"p-textarea-resizable ":n.autoResize,"p-textarea-sm p-inputfield-sm":n.size===`small`,"p-textarea-lg p-inputfield-lg":n.size===`large`,"p-invalid":t.$invalid,"p-variant-filled":t.$variant===`filled`,"p-textarea-fluid":t.$fluid}]}}}),Fe={name:`BaseTextarea`,extends:R,props:{autoResize:Boolean},style:Pe,provide:function(){return{$pcTextarea:this,$parentInstance:this}}};function $(e){"@babel/helpers - typeof";return $=typeof Symbol==`function`&&typeof Symbol.iterator==`symbol`?function(e){return typeof e}:function(e){return e&&typeof Symbol==`function`&&e.constructor===Symbol&&e!==Symbol.prototype?`symbol`:typeof e},$(e)}function Ie(e,t,n){return(t=Le(t))in e?Object.defineProperty(e,t,{value:n,enumerable:!0,configurable:!0,writable:!0}):e[t]=n,e}function Le(e){var t=Re(e,`string`);return $(t)==`symbol`?t:t+``}function Re(e,t){if($(e)!=`object`||!e)return e;var n=e[Symbol.toPrimitive];if(n!==void 0){var r=n.call(e,t);if($(r)!=`object`)return r;throw TypeError(`@@toPrimitive must return a primitive value.`)}return(t===`string`?String:Number)(e)}var ze={name:`Textarea`,extends:Fe,inheritAttrs:!1,observer:null,mounted:function(){var e=this;this.autoResize&&(this.observer=new ResizeObserver(function(){requestAnimationFrame(function(){e.resize()})}),this.observer.observe(this.$el))},updated:function(){this.autoResize&&this.resize()},beforeUnmount:function(){this.observer&&this.observer.disconnect()},methods:{resize:function(){if(this.$el.offsetParent){var e=this.$el.style.height,t=parseInt(e)||0,n=this.$el.scrollHeight;t&&n<t?(this.$el.style.height=`auto`,this.$el.style.height=`${this.$el.scrollHeight}px`):(!t||n>t)&&(this.$el.style.height=`${n}px`)}},onInput:function(e){this.autoResize&&this.resize(),this.writeValue(e.target.value,e)}},computed:{attrs:function(){return v(this.ptmi(`root`,{context:{filled:this.$filled,disabled:this.disabled}}),this.formField)},dataP:function(){return b(Ie({invalid:this.$invalid,fluid:this.$fluid,filled:this.$variant===`filled`},this.size,this.size))}}},Be=[`value`,`name`,`disabled`,`aria-invalid`,`data-p`];function Ve(e,t,n,r,a,o){return i(),A(`textarea`,v({class:e.cx(`root`),value:e.d_value,name:e.name,disabled:e.disabled,"aria-invalid":e.invalid||void 0,"data-p":o.dataP,onInput:t[0]||=function(){return o.onInput&&o.onInput.apply(o,arguments)}},o.attrs),null,16,Be)}ze.render=Ve;var He={class:`field`,for:`application-name`},Ue={class:`field`,for:`application-slug`},We={class:`field`,for:`application-environment`},Ge={class:`field`,for:`application-client-type`},Ke={class:`field field-full`,for:`application-redirect-uris`},qe={class:`field field-full`,for:`application-scopes`},Je={class:`field field-full checkbox-field`},Ye=u({__name:`ApplicationFormFields`,props:{modelValue:{required:!0},modelModifiers:{}},emits:e([`submit`],[`update:modelValue`]),setup(e){let t=a(e,`modelValue`),r=[{label:`开发环境`,value:`development`},{label:`预发布环境`,value:`staging`},{label:`生产环境`,value:`production`}],o=[{label:`机密客户端（服务端应用）`,value:`confidential`},{label:`公共客户端（原生应用 / SPA）`,value:`public`}];return(e,a)=>(i(),A(`form`,{class:`application-form`,onSubmit:a[7]||=N(t=>e.$emit(`submit`),[`prevent`])},[h(`label`,He,[a[8]||=h(`span`,null,`应用名称`,-1),D(w(I),{id:`application-name`,modelValue:t.value.name,"onUpdate:modelValue":a[0]||=e=>t.value.name=e,autocomplete:`off`,maxlength:`120`,required:``,autofocus:``,placeholder:`例如：内部工单系统`},null,8,[`modelValue`])]),h(`label`,Ue,[a[9]||=h(`span`,null,`Slug（可选）`,-1),D(w(I),{id:`application-slug`,modelValue:t.value.slug,"onUpdate:modelValue":a[1]||=e=>t.value.slug=e,autocomplete:`off`,maxlength:`80`,pattern:`[a-z0-9]+(-[a-z0-9]+)*`,"aria-describedby":`application-slug-help`,placeholder:`例如：internal-ticket`},null,8,[`modelValue`]),a[10]||=h(`small`,{id:`application-slug-help`,class:`field-help`},`仅小写字母、数字和单个连字符`,-1)]),h(`label`,We,[a[11]||=h(`span`,null,`运行环境`,-1),D(w(L),{"input-id":`application-environment`,modelValue:t.value.environment,"onUpdate:modelValue":a[2]||=e=>t.value.environment=e,options:r,"option-label":`label`,"option-value":`value`},null,8,[`modelValue`])]),h(`label`,Ge,[a[12]||=h(`span`,null,`客户端类型`,-1),D(w(L),{"input-id":`application-client-type`,modelValue:t.value.clientType,"onUpdate:modelValue":a[3]||=e=>t.value.clientType=e,options:o,"option-label":`label`,"option-value":`value`,"aria-describedby":`application-client-type-help`},null,8,[`modelValue`]),a[13]||=h(`small`,{id:`application-client-type-help`,class:`field-help`},` 公共客户端不会生成 client secret，并强制使用 PKCE S256 `,-1)]),h(`label`,Ke,[a[14]||=h(`span`,null,`Redirect URI`,-1),D(w(ze),{id:`application-redirect-uris`,modelValue:t.value.redirectUris,"onUpdate:modelValue":a[4]||=e=>t.value.redirectUris=e,rows:`3`,required:``,"aria-describedby":`application-redirect-help`,placeholder:`每行一个完整回调地址`},null,8,[`modelValue`]),a[15]||=h(`small`,{id:`application-redirect-help`,class:`field-help`},` 每行一个；生产与预发布环境必须使用 HTTPS `,-1)]),h(`label`,qe,[a[16]||=h(`span`,null,`Scopes`,-1),D(w(I),{id:`application-scopes`,modelValue:t.value.scopes,"onUpdate:modelValue":a[5]||=e=>t.value.scopes=e,required:``,"aria-describedby":`application-scopes-help`,placeholder:`openid profile email`},null,8,[`modelValue`]),a[17]||=h(`small`,{id:`application-scopes-help`,class:`field-help`},[n(` 使用空格、逗号或换行分隔，必须包含 `),h(`code`,null,`openid`)],-1)]),h(`div`,Je,[D(w(z),{modelValue:t.value.refreshToken,"onUpdate:modelValue":a[6]||=e=>t.value.refreshToken=e,"input-id":`application-refresh-token`,binary:``},null,8,[`modelValue`]),a[18]||=h(`label`,{for:`application-refresh-token`},[n(` 启用 Refresh Token `),h(`small`,{class:`field-help`},[n(`提交时会自动加入 `),h(`code`,null,`offline_access`),n(` scope`)])],-1)])],32))}}),Xe={class:`field field-full`,for:`template-reference`},Ze={key:0,class:`field-help`},Qe={class:`field`,for:`template-application-name`},$e={class:`field`,for:`template-application-slug`},et=[`for`],tt={key:2,class:`field-help`},nt=u({__name:`ApplicationTemplateFormFields`,props:e({templates:{}},{modelValue:{required:!0},modelModifiers:{}}),emits:e([`submit`],[`update:modelValue`]),setup(e){let t=e,n=a(e,`modelValue`),r=g(()=>t.templates.map(e=>({label:`${e.name} · ${e.reference.id}@${e.reference.version}`,value:`${e.reference.id}@${e.reference.version}`}))),o=g(()=>t.templates.find(e=>`${e.reference.id}@${e.reference.version}`===n.value.templateKey)),c=()=>{let e=o.value;n.value.templateInput=Object.fromEntries((e?.form.fields??[]).map(e=>[e.name,e.defaultValue??``]))};return S(()=>n.value.templateKey,(e,t)=>{e!==t&&c()}),(e,t)=>(i(),A(`form`,{class:`application-form`,onSubmit:t[3]||=N(t=>e.$emit(`submit`),[`prevent`])},[h(`label`,Xe,[t[4]||=h(`span`,null,`应用模板`,-1),D(w(L),{"input-id":`template-reference`,modelValue:n.value.templateKey,"onUpdate:modelValue":t[0]||=e=>n.value.templateKey=e,options:r.value,"option-label":`label`,"option-value":`value`},null,8,[`modelValue`,`options`]),o.value?(i(),A(`small`,Ze,E(o.value.description),1)):T(``,!0)]),h(`label`,Qe,[t[5]||=h(`span`,null,`应用名称`,-1),D(w(I),{id:`template-application-name`,modelValue:n.value.name,"onUpdate:modelValue":t[1]||=e=>n.value.name=e,maxlength:`120`,required:``,autocomplete:`off`,placeholder:`例如：研发代码平台`},null,8,[`modelValue`])]),h(`label`,$e,[t[6]||=h(`span`,null,`Slug（可选）`,-1),D(w(I),{id:`template-application-slug`,modelValue:n.value.slug,"onUpdate:modelValue":t[2]||=e=>n.value.slug=e,maxlength:`80`,pattern:`[a-z0-9]+(-[a-z0-9]+)*`,autocomplete:`off`,placeholder:`例如：engineering-platform`},null,8,[`modelValue`])]),(i(!0),A(m,null,s(o.value?.form.fields??[],e=>(i(),A(`label`,{key:e.name,class:_([`field`,{"field-full":e.kind===`url`}]),for:`template-input-${e.name}`},[h(`span`,null,E(e.label)+E(e.required?``:`（可选）`),1),e.kind===`select`?(i(),p(w(L),{key:0,"input-id":`template-input-${e.name}`,modelValue:n.value.templateInput[e.name],"onUpdate:modelValue":t=>n.value.templateInput[e.name]=t,options:e.options,"option-label":`label`,"option-value":`value`},null,8,[`input-id`,`modelValue`,`onUpdate:modelValue`,`options`])):(i(),p(w(I),{key:1,id:`template-input-${e.name}`,modelValue:n.value.templateInput[e.name],"onUpdate:modelValue":t=>n.value.templateInput[e.name]=t,type:e.kind===`url`?`url`:`text`,required:e.required,placeholder:e.placeholder,autocomplete:`off`},null,8,[`id`,`modelValue`,`onUpdate:modelValue`,`type`,`required`,`placeholder`])),e.description?(i(),A(`small`,tt,E(e.description),1)):T(``,!0)],10,et))),128))],32))}}),rt={class:`integration-guide`},it={key:0},at={key:0},ot={key:1},st={key:2},ct={key:3},lt={key:4,class:`guide-field`},ut={key:0,class:`field-help`},dt={key:5,class:`guide-code`},ft={key:0},pt={key:7,class:`guide-steps`},mt=u({__name:`IntegrationGuideDetails`,props:{guide:{}},emits:[`copy`],setup(e){return(t,r)=>(i(),A(`article`,rt,[h(`header`,null,[h(`h2`,null,E(e.guide.title),1),e.guide.description?(i(),A(`p`,it,E(e.guide.description),1)):T(``,!0)]),(i(!0),A(m,null,s(e.guide.nodes,(e,r)=>(i(),A(m,{key:`${e.kind}-${r}`},[e.kind===`heading`&&e.level===2?(i(),A(`h3`,at,E(e.text),1)):e.kind===`heading`&&e.level===3?(i(),A(`h4`,ot,E(e.text),1)):e.kind===`heading`?(i(),A(`h5`,st,E(e.text),1)):e.kind===`paragraph`?(i(),A(`p`,ct,E(e.text),1)):e.kind===`field`?(i(),A(`dl`,lt,[h(`dt`,null,E(e.label),1),h(`dd`,null,[h(`code`,null,E(e.value),1),e.copyable?(i(),p(w(C),{key:0,icon:`pi pi-copy`,text:``,rounded:``,severity:`secondary`,"aria-label":`复制${e.label}`,onClick:n=>t.$emit(`copy`,e.value,e.label)},null,8,[`aria-label`,`onClick`])):T(``,!0)]),e.description?(i(),A(`dd`,ut,E(e.description),1)):T(``,!0)])):e.kind===`code`?(i(),A(`figure`,dt,[e.caption?(i(),A(`figcaption`,ft,E(e.caption),1)):T(``,!0),h(`pre`,null,[h(`code`,null,E(e.code),1)]),D(w(C),{icon:`pi pi-copy`,label:`复制命令`,size:`small`,severity:`secondary`,outlined:``,onClick:n=>t.$emit(`copy`,e.code,`命令`)},null,8,[`onClick`])])):e.kind===`warning`?(i(),p(w(F),{key:6,severity:`warn`,closable:!1},{default:o(()=>[n(E(e.text),1)]),_:2},1024)):e.kind===`steps`?(i(),A(`ol`,pt,[(i(!0),A(m,null,s(e.items,e=>(i(),A(`li`,{key:e},E(e),1))),128))])):T(``,!0)],64))),128))]))}}),ht={class:`content-panel`},gt={class:`stacked-cell`},_t={key:0,class:`stacked-cell`},vt={key:1},yt={class:`text-break`},bt={class:`row-actions`},xt={key:1,class:`public-client-note`},St={class:`empty-state`},Ct={class:`application-create-mode`},wt={key:0,class:`field-help`},Tt={key:1,class:`field-help`},Et={key:0,class:`connection-details`},Dt=u({__name:`ApplicationsView`,setup(e){let t=[{label:`开发环境`,value:`development`},{label:`预发布环境`,value:`staging`},{label:`生产环境`,value:`production`}],r=()=>({name:``,slug:``,environment:`development`,clientType:`confidential`,redirectUris:`http://localhost:3000/oidc/callback`,scopes:`openid profile email`,refreshToken:!1}),a=(e=[])=>{let t=[...e].sort((e,t)=>{let n=e.name.localeCompare(t.name);return n===0?t.reference.version-e.reference.version:n})[0];return{name:``,slug:``,templateKey:t?`${t.reference.id}@${t.reference.version}`:``,templateInput:Object.fromEntries((t?.form.fields??[]).map(e=>[e.name,e.defaultValue??``]))}},s=[{label:`使用模板`,value:`template`},{label:`自定义 OIDC`,value:`custom`}],l=ee(),u=te(),{setError:d}=fe(),_=f([]),v=f([]),y=f(!1),b=f(``),x=f(!1),S=f(!1),O=f(!1),k=f(!1),j=f(!1),M=f(``),N=f(``),L=f(``),R=f(``),z=f(``),B=f(r()),H=f(a()),U=f(`template`),W=f(null),G=f(`create`),K=f(null),q=f(null),J=f(!1),Y=f(null),ge=g(()=>v.value.find(e=>`${e.reference.id}@${e.reference.version}`===H.value.templateKey)),_e=g(()=>{let e=b.value.trim().toLowerCase();return e?_.value.filter(({application:t,clients:n})=>[t.name,t.slug,t.status,...n.map(e=>e.clientId)].some(t=>t.toLowerCase().includes(e))):_.value}),ve=e=>[...new Set(e.split(/[\s,]+/u).map(e=>e.trim()).filter(Boolean))],ye=()=>{let e=globalThis.crypto.getRandomValues(new Uint8Array(16));e[6]=e[6]&15|64,e[8]=e[8]&63|128;let t=[...e].map(e=>e.toString(16).padStart(2,`0`));return[t.slice(0,4).join(``),t.slice(4,6).join(``),t.slice(6,8).join(``),t.slice(8,10).join(``),t.slice(10).join(``)].join(`-`)},be=()=>{let e=B.value.name.trim(),t=B.value.slug.trim(),n=ve(B.value.redirectUris),r=ve(B.value.scopes);if(!e)throw Error(`应用名称不能为空`);if(e.length>120)throw Error(`应用名称不能超过 120 个字符`);if(t&&(t.length>80||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(t)))throw Error(`slug 只能包含小写字母、数字和单个连字符`);if(n.length===0)throw Error(`至少需要一个 Redirect URI`);if(!r.includes(`openid`))throw Error(`Scopes 必须包含 openid`);for(let e of n){let t;try{t=new URL(e)}catch{throw Error(`Redirect URI 不是有效的绝对地址：${e}`)}let n=[`localhost`,`127.0.0.1`,`[::1]`].includes(t.hostname),r=B.value.environment===`development`&&t.protocol===`http:`&&n;if(t.protocol!==`https:`&&!r)throw Error(`Redirect URI 必须使用 HTTPS，开发环境仅允许 HTTP loopback 地址`);if(t.search||t.hash||t.username||t.password||e.includes(`*`))throw Error(`Redirect URI 不能包含 query、通配符、fragment 或用户凭据`)}return B.value.refreshToken&&!r.includes(`offline_access`)&&r.push(`offline_access`),{schemaVersion:1,application:{name:e,...t?{slug:t}:{},environment:B.value.environment,trustLevel:`third_party`,consentPolicy:`explicit`},client:{clientType:B.value.clientType,redirectUris:n,postLogoutRedirectUris:[],scopes:r,resources:[],refreshToken:B.value.refreshToken,providerApi:!1,resourceServer:!1,pkcePolicy:`required`},credentialDelivery:`direct`}},xe=()=>{let e=ge.value;if(!e)throw Error(`请选择一个可用的应用模板`);let t=H.value.name.trim(),n=H.value.slug.trim();if(!t)throw Error(`应用名称不能为空`);if(t.length>120)throw Error(`应用名称不能超过 120 个字符`);if(n&&(n.length>80||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(n)))throw Error(`slug 只能包含小写字母、数字和单个连字符`);let r={};for(let t of e.form.fields){let e=(H.value.templateInput[t.name]??``).trim();if(t.required&&!e)throw Error(`${t.label}不能为空`);e&&(r[t.name]=e)}return{schemaVersion:1,template:e.reference,application:{name:t,...n?{slug:n}:{}},templateInput:r,credentialDelivery:`direct`}},Se=async()=>{z.value=``;let e;try{e=xe()}catch(e){z.value=e instanceof Error?e.message:String(e);return}J.value=!0;try{let t=await se({schemaVersion:1,template:e.template,templateInput:e.templateInput});if(!t)return;q.value=t,k.value=!0}catch(e){z.value=e instanceof Error?e.message:String(e),X(e,`预览模板失败`)}finally{J.value=!1}},X=(e,t=`操作失败`)=>{let n=e instanceof Error?e.message:String(e);d(n),u.add({severity:`error`,summary:t,detail:n,life:4200})},Z=async()=>{y.value=!0;try{_.value=await le()??[],d(``)}catch(e){X(e,`加载应用失败`)}finally{y.value=!1}},Ce=async()=>{try{v.value=await ie()??[]}catch(e){X(e,`加载应用模板失败`)}},we=()=>{B.value=r(),H.value=a(v.value),U.value=v.value.length>0?`template`:`custom`,z.value=``,Y.value=null,x.value=!0},Ee=async()=>{z.value=``;let e;try{e=U.value===`template`?xe():be()}catch(e){z.value=e instanceof Error?e.message:String(e);return}let t=JSON.stringify({mode:U.value,payload:e});Y.value?.payload!==t&&(Y.value={payload:t,idempotencyKey:ye()}),j.value=!0;try{let t=U.value===`template`?await ue(e,Y.value.idempotencyKey):await ce(e,Y.value.idempotencyKey);if(!t)return;W.value=t,G.value=`create`,x.value=!1,S.value=!0,Y.value=null,await Z(),u.add({severity:t.credentialDelivery.kind===`already_delivered`?`warn`:`success`,summary:t.credentialDelivery.kind===`already_delivered`?`请求已处理，密钥未重复返回`:`应用已创建`,life:3200})}catch(e){z.value=e instanceof Error?e.message:String(e),X(e,`创建应用失败`)}finally{j.value=!1}},De=async(e,t)=>{M.value=e.application.id;try{let n=t?oe:ne,r=!t&&e.application.status===`disabling`?e.application.version-1:e.application.version,i=await n(e.application.id,r);if(!i)return;let a=_.value.findIndex(({application:t})=>t.id===e.application.id);a>=0&&(_.value=_.value.map((e,t)=>t===a?i:e)),d(``),u.add({severity:`success`,summary:t?`应用已启用`:`应用已禁用`,life:2400})}catch(e){X(e,t?`启用应用失败`:`禁用应用失败`)}finally{M.value=``}},Oe=e=>{l.require({header:`禁用应用`,message:`确认禁用应用 ${e.application.name}？它的 OIDC Client 将无法继续认证。`,icon:`pi pi-exclamation-triangle`,acceptLabel:`禁用`,rejectLabel:`取消`,acceptClass:`p-button-danger`,accept:()=>De(e,!1)})},ke=e=>e.application.source.kind!==`system`&&e.clients[0]?.clientType===`confidential`&&[`active`,`disabled`].includes(e.application.status),Ae=async e=>{N.value=e.application.id;try{let t=await ae(e.application.id,{schemaVersion:1,expectedVersion:e.application.version});if(!t)return;W.value=t,G.value=`rotate`,S.value=!0,await Z(),u.add({severity:`success`,summary:`Client Secret 已轮换`,life:2600})}catch(e){await Z();let t=e instanceof Error?e.message:String(e);d(t),u.add({severity:`error`,summary:`轮换结果未确认`,detail:`${t}。列表已刷新；如果服务端已提交，请使用最新版本再次轮换。`,life:5200})}finally{N.value=``}},je=e=>{l.require({header:`轮换 Client Secret`,message:`确认轮换应用 ${e.application.name} 的 Client Secret？旧密钥会立即失效。`,icon:`pi pi-key`,acceptLabel:`轮换密钥`,rejectLabel:`取消`,acceptClass:`p-button-danger`,accept:()=>Ae(e)})},Q=async(e,t)=>{try{await navigator.clipboard.writeText(e),u.add({severity:`success`,summary:`${t}已复制`,life:1800})}catch{u.add({severity:`warn`,summary:`无法访问剪贴板`,detail:`请手动选择并复制该值。`,life:3200})}},Me=(e,t)=>{let n=new Blob([`${JSON.stringify(e,null,2)}\n`],{type:`application/json;charset=utf-8`}),r=URL.createObjectURL(n),i=document.createElement(`a`);i.href=r,i.download=t,i.click(),URL.revokeObjectURL(r)},Pe=e=>`${e.slug||e.id}.gitea-oidc.connection.json`,Fe=async e=>{L.value=e.application.id;try{let t=await de(e.application.id);if(!t)return;Me(t,Pe(e.application)),u.add({severity:`success`,summary:`连接配置已下载`,life:1800})}catch(e){X(e,`下载连接配置失败`)}finally{L.value=``}},$=async e=>{R.value=e.application.id;try{let t=await re(e.application.id);if(!t)return;K.value=t,O.value=!0}catch(e){X(e,`加载接入说明失败`)}finally{R.value=``}},Ie=()=>{let e=W.value;e&&Me(e.connection,Pe(e.application))},Le=()=>{let e=W.value;!e||e.credentialDelivery.kind!==`direct`||e.credentialDelivery.credential.kind!==`client_secret`||Me(e.credentialDelivery.credential,`${e.application.slug||e.application.id}.gitea-oidc.credential.json`)},Re=()=>{S.value=!1},ze=()=>{W.value=null,G.value=`create`},Be=e=>({draft:`草稿`,active:`已启用`,disabling:`等待撤销`,disabled:`已禁用`,deleted:`已删除`})[e],Ve=e=>({draft:`secondary`,active:`success`,disabling:`danger`,disabled:`warn`,deleted:`danger`})[e],He=e=>t.find(t=>t.value===e)?.label??e,Ue=e=>e.source.kind===`template`?`${e.source.templateId}@${e.source.templateVersion}`:e.source.kind===`custom`?`自定义`:`系统配置`;return c(()=>{Promise.all([Z(),Ce()])}),(e,t)=>(i(),A(m,null,[h(`section`,ht,[D(w(he),{class:`admin-toolbar`},{start:o(()=>[t[11]||=h(`label`,{class:`sr-only`,for:`application-search`},`搜索应用`,-1),D(w(I),{id:`application-search`,modelValue:b.value,"onUpdate:modelValue":t[0]||=e=>b.value=e,class:`application-search`,placeholder:`搜索名称、slug、client_id 或状态`},null,8,[`modelValue`])]),end:o(()=>[D(w(C),{icon:`pi pi-refresh`,label:`刷新列表`,severity:`secondary`,outlined:``,loading:y.value,onClick:Z},null,8,[`loading`]),D(w(C),{icon:`pi pi-plus`,label:`创建应用`,onClick:we})]),_:1}),D(w(pe),{value:_e.value,"data-key":`application.id`,paginator:``,rows:8,"rows-per-page-options":[8,16,32],loading:y.value,"striped-rows":``,scrollable:``,"table-style":`min-width: 74rem`},{empty:o(()=>[h(`div`,St,E(b.value?`没有匹配的应用`:`暂无应用`),1)]),default:o(()=>[D(w(V),{header:`应用`,sortable:``,"sort-field":`application.name`,style:{"min-width":`15rem`}},{body:o(({data:e})=>[h(`div`,gt,[h(`strong`,null,E(e.application.name),1),h(`small`,null,E(e.application.slug),1)])]),_:1}),D(w(V),{header:`环境`,sortable:``,"sort-field":`application.environment`,style:{"min-width":`8rem`}},{body:o(({data:e})=>[n(E(He(e.application.environment)),1)]),_:1}),D(w(V),{header:`来源`,style:{"min-width":`8rem`}},{body:o(({data:e})=>[n(E(Ue(e.application)),1)]),_:1}),D(w(V),{header:`Client`,style:{"min-width":`18rem`}},{body:o(({data:e})=>[e.clients[0]?(i(),A(`div`,_t,[h(`strong`,null,E(e.clients[0].clientId),1),h(`small`,null,E(e.clients[0].clientType===`public`?`公共客户端`:`机密客户端`),1)])):(i(),A(`span`,vt,`-`))]),_:1}),D(w(V),{header:`Redirect URI`,style:{"min-width":`21rem`}},{body:o(({data:e})=>[h(`span`,yt,E(e.clients[0]?.redirectUris.join(`, `)||`-`),1)]),_:1}),D(w(V),{header:`Scopes`,style:{"min-width":`15rem`}},{body:o(({data:e})=>[n(E(e.clients[0]?.allowedScopes.join(` `)||`-`),1)]),_:1}),D(w(V),{header:`状态`,sortable:``,"sort-field":`application.status`,style:{"min-width":`8rem`}},{body:o(({data:e})=>[D(me,{value:Be(e.application.status),severity:Ve(e.application.status)},null,8,[`value`,`severity`])]),_:1}),D(w(V),{header:`操作`,style:{"min-width":`32rem`}},{body:o(({data:e})=>[h(`div`,bt,[D(w(C),{icon:`pi pi-download`,label:`配置`,size:`small`,severity:`secondary`,outlined:``,loading:L.value===e.application.id,"aria-label":`下载应用 ${e.application.name} 的公开连接配置`,onClick:t=>Fe(e)},null,8,[`loading`,`aria-label`,`onClick`]),D(w(C),{icon:`pi pi-book`,label:`接入说明`,size:`small`,severity:`secondary`,outlined:``,loading:R.value===e.application.id,"aria-label":`查看应用 ${e.application.name} 的接入说明`,onClick:t=>$(e)},null,8,[`loading`,`aria-label`,`onClick`]),ke(e)?(i(),p(w(C),{key:0,icon:`pi pi-key`,label:`轮换密钥`,size:`small`,severity:`danger`,outlined:``,loading:N.value===e.application.id,"aria-label":`轮换应用 ${e.application.name} 的 Client Secret`,onClick:t=>je(e)},null,8,[`loading`,`aria-label`,`onClick`])):T(``,!0),e.application.source.kind===`system`?(i(),A(`span`,xt,` 配置管理 `)):e.application.status===`active`?(i(),p(w(C),{key:2,icon:`pi pi-ban`,label:`禁用`,size:`small`,severity:`warn`,outlined:``,loading:M.value===e.application.id,"aria-label":`禁用应用 ${e.application.name}`,onClick:t=>Oe(e)},null,8,[`loading`,`aria-label`,`onClick`])):e.application.status===`disabling`?(i(),p(w(C),{key:3,icon:`pi pi-refresh`,label:`重试撤销`,size:`small`,severity:`danger`,outlined:``,loading:M.value===e.application.id,"aria-label":`重试撤销应用 ${e.application.name} 的 OIDC 凭据`,onClick:t=>De(e,!1)},null,8,[`loading`,`aria-label`,`onClick`])):e.application.status===`deleted`?T(``,!0):(i(),p(w(C),{key:4,icon:`pi pi-check`,label:`启用`,size:`small`,severity:`success`,outlined:``,loading:M.value===e.application.id,"aria-label":`启用应用 ${e.application.name}`,onClick:t=>De(e,!0)},null,8,[`loading`,`aria-label`,`onClick`]))])]),_:1})]),_:1},8,[`value`,`loading`])]),D(w(P),{visible:x.value,"onUpdate:visible":t[5]||=e=>x.value=e,modal:``,header:`创建应用`,draggable:!1,style:{width:`min(760px, calc(100vw - 32px))`}},{footer:o(()=>[D(w(C),{label:`取消`,severity:`secondary`,outlined:``,onClick:t[4]||=e=>x.value=!1}),U.value===`template`?(i(),p(w(C),{key:0,icon:`pi pi-eye`,label:`预览配置`,severity:`secondary`,outlined:``,loading:J.value,onClick:Se},null,8,[`loading`])):T(``,!0),D(w(C),{icon:`pi pi-check`,label:`创建应用`,loading:j.value,onClick:Ee},null,8,[`loading`])]),default:o(()=>[z.value?(i(),p(w(F),{key:0,severity:`error`,closable:!1,class:`form-message`},{default:o(()=>[n(E(z.value),1)]),_:1})):T(``,!0),h(`div`,Ct,[t[12]||=h(`span`,null,`创建方式`,-1),D(w(Te),{modelValue:U.value,"onUpdate:modelValue":t[1]||=e=>U.value=e,options:s,"option-label":`label`,"option-value":`value`,"allow-empty":!1},null,8,[`modelValue`]),U.value===`template`?(i(),A(`small`,wt,` 模板会生成经过约束的 OIDC Client，并在创建后给出 Gitea 管理后台与 CLI 配置说明。 `)):(i(),A(`small`,Tt,` 自定义模式适合未内置支持的系统，请自行确认回调、Scope 与 PKCE 兼容性。 `))]),U.value===`template`&&v.value.length>0?(i(),p(nt,{key:1,modelValue:H.value,"onUpdate:modelValue":t[2]||=e=>H.value=e,templates:v.value,onSubmit:Ee},null,8,[`modelValue`,`templates`])):U.value===`template`?(i(),p(w(F),{key:2,severity:`warn`,closable:!1,class:`form-message`},{default:o(()=>[...t[13]||=[n(` 当前服务端没有可用模板，请切换到自定义 OIDC。 `,-1)]]),_:1})):(i(),p(Ye,{key:3,modelValue:B.value,"onUpdate:modelValue":t[3]||=e=>B.value=e,onSubmit:Ee},null,8,[`modelValue`]))]),_:1},8,[`visible`]),D(w(P),{visible:k.value,"onUpdate:visible":t[6]||=e=>k.value=e,modal:``,header:`模板配置预览`,draggable:!1,style:{width:`min(860px, calc(100vw - 32px))`},onAfterHide:t[7]||=e=>q.value=null},{default:o(()=>[q.value?(i(),A(`dl`,Et,[t[14]||=h(`dt`,null,`Issuer`,-1),h(`dd`,null,[h(`code`,null,E(q.value.issuer),1)]),t[15]||=h(`dt`,null,`Redirect URI`,-1),h(`dd`,null,[h(`code`,null,E(q.value.client.redirectUris.join(`
`)),1)]),t[16]||=h(`dt`,null,`Scopes`,-1),h(`dd`,null,[h(`code`,null,E(q.value.client.scopes.join(` `)),1)]),t[17]||=h(`dt`,null,`PKCE`,-1),h(`dd`,null,[h(`code`,null,E(q.value.client.pkcePolicy),1)])])):T(``,!0),q.value?(i(),p(mt,{key:1,guide:q.value.integrationGuide,onCopy:Q},null,8,[`guide`])):T(``,!0)]),_:1},8,[`visible`]),D(w(P),{visible:S.value,"onUpdate:visible":t[8]||=e=>S.value=e,modal:``,header:G.value===`rotate`?`保存新的 Client Secret`:`保存应用接入配置`,closable:!1,"close-on-escape":!1,"dismissable-mask":!1,draggable:!1,style:{width:`min(780px, calc(100vw - 32px))`},onAfterHide:ze},{footer:o(()=>[D(w(C),{icon:`pi pi-download`,label:`下载连接配置`,severity:`secondary`,outlined:``,onClick:Ie}),W.value?.credentialDelivery.kind===`direct`&&W.value.credentialDelivery.credential.kind===`client_secret`?(i(),p(w(C),{key:0,icon:`pi pi-key`,label:`下载一次性凭据`,severity:`warn`,outlined:``,onClick:Le})):T(``,!0),D(w(C),{icon:`pi pi-check`,label:`我已保存配置，关闭`,severity:`danger`,onClick:Re})]),default:o(()=>[W.value?(i(),p(Ne,{key:0,result:W.value,rotated:G.value===`rotate`,onCopy:Q},null,8,[`result`,`rotated`])):T(``,!0),W.value?(i(),p(mt,{key:1,guide:W.value.integrationGuide,onCopy:Q},null,8,[`guide`])):T(``,!0)]),_:1},8,[`visible`,`header`]),D(w(P),{visible:O.value,"onUpdate:visible":t[9]||=e=>O.value=e,modal:``,header:`应用接入说明`,draggable:!1,style:{width:`min(860px, calc(100vw - 32px))`},onAfterHide:t[10]||=e=>K.value=null},{default:o(()=>[K.value?(i(),p(mt,{key:0,guide:K.value,onCopy:Q},null,8,[`guide`])):T(``,!0)]),_:1},8,[`visible`])],64))}});export{Dt as default};