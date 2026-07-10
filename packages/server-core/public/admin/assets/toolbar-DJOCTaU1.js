import{F as e,R as t,g as n,j as r,l as i,s as a,y as o}from"./button-30OeERU8.js";var s=i.extend({name:`toolbar`,style:`
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
`,classes:{root:`p-toolbar p-component`,start:`p-toolbar-start`,center:`p-toolbar-center`,end:`p-toolbar-end`}}),c={name:`Toolbar`,extends:{name:`BaseToolbar`,extends:a,props:{ariaLabelledby:{type:String,default:null}},style:s,provide:function(){return{$pcToolbar:this,$parentInstance:this}}},inheritAttrs:!1},l=[`aria-labelledby`];function u(i,a,s,c,u,d){return e(),o(`div`,r({class:i.cx(`root`),role:`toolbar`,"aria-labelledby":i.ariaLabelledby},i.ptmi(`root`)),[n(`div`,r({class:i.cx(`start`)},i.ptm(`start`)),[t(i.$slots,`start`)],16),n(`div`,r({class:i.cx(`center`)},i.ptm(`center`)),[t(i.$slots,`center`)],16),n(`div`,r({class:i.cx(`end`)},i.ptm(`end`)),[t(i.$slots,`end`)],16)],16,l)}c.render=u;export{c as t};