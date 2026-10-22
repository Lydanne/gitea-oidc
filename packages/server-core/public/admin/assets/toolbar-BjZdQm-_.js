import{I as e,X as t,ct as n,ot as r,q as i,rt as a,z as o}from"./index-DKD54ebl.js";var s=o.extend({name:`toolbar`,style:`
    .p-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        padding: dt('toolbar.padding');
        background: dt('toolbar.background');
        border: 1px solid dt('toolbar.border.color');
        color: dt('toolbar.color');
        border-radius: dt('toolbar.border.radius');
        gap: dt('toolbar.gap');
    }

    .p-toolbar-start,
    .p-toolbar-center,
    .p-toolbar-end {
        display: flex;
        align-items: center;
    }
`,classes:{root:`p-toolbar p-component`,start:`p-toolbar-start`,center:`p-toolbar-center`,end:`p-toolbar-end`}}),c={name:`Toolbar`,extends:{name:`BaseToolbar`,extends:e,props:{ariaLabelledby:{type:String,default:null}},style:s,provide:function(){return{$pcToolbar:this,$parentInstance:this}}},inheritAttrs:!1},l=[`aria-labelledby`];function u(e,o,s,c,u,d){return r(),t(`div`,a({class:e.cx(`root`),role:`toolbar`,"aria-labelledby":e.ariaLabelledby},e.ptmi(`root`)),[i(`div`,a({class:e.cx(`start`)},e.ptm(`start`)),[n(e.$slots,`start`)],16),i(`div`,a({class:e.cx(`center`)},e.ptm(`center`)),[n(e.$slots,`center`)],16),i(`div`,a({class:e.cx(`end`)},e.ptm(`end`)),[n(e.$slots,`end`)],16)],16,l)}c.render=u;export{c as t};