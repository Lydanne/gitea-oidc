import{I as e,g as t,j as n,l as r,s as i,y as a,z as o}from"./button-DIfwJMUq.js";var s=r.extend({name:`toolbar`,style:`
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
`,classes:{root:`p-toolbar p-component`,start:`p-toolbar-start`,center:`p-toolbar-center`,end:`p-toolbar-end`}}),c={name:`Toolbar`,extends:{name:`BaseToolbar`,extends:i,props:{ariaLabelledby:{type:String,default:null}},style:s,provide:function(){return{$pcToolbar:this,$parentInstance:this}}},inheritAttrs:!1},l=[`aria-labelledby`];function u(r,i,s,c,u,d){return e(),a(`div`,n({class:r.cx(`root`),role:`toolbar`,"aria-labelledby":r.ariaLabelledby},r.ptmi(`root`)),[t(`div`,n({class:r.cx(`start`)},r.ptm(`start`)),[o(r.$slots,`start`)],16),t(`div`,n({class:r.cx(`center`)},r.ptm(`center`)),[o(r.$slots,`center`)],16),t(`div`,n({class:r.cx(`end`)},r.ptm(`end`)),[o(r.$slots,`end`)],16)],16,l)}c.render=u;export{c as t};