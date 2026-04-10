import * as ___react___ from 'react';
import * as ___react_dom___ from 'react-dom'; 

function require(mod) {
  if (mod === 'react') return ___react___;
  if (mod === 'react-dom') return ___react_dom___;
  throw new Error(`Unknown module ${mod}`);
}
var g=Object.create;var e=Object.defineProperty;var h=Object.getOwnPropertyDescriptor;var i=Object.getOwnPropertyNames;var j=Object.getPrototypeOf,k=Object.prototype.hasOwnProperty;var m=(a=>typeof require<"u"?require:typeof Proxy<"u"?new Proxy(a,{get:(b,c)=>(typeof require<"u"?require:b)[c]}):a)(function(a){if(typeof require<"u")return require.apply(this,arguments);throw Error('Dynamic require of "'+a+'" is not supported')});var n=(a,b)=>()=>(b||a((b={exports:{}}).exports,b),b.exports),o=(a,b)=>{for(var c in b)e(a,c,{get:b[c],enumerable:!0})},l=(a,b,c,f)=>{if(b&&typeof b=="object"||typeof b=="function")for(let d of i(b))!k.call(a,d)&&d!==c&&e(a,d,{get:()=>b[d],enumerable:!(f=h(b,d))||f.enumerable});return a};var p=(a,b,c)=>(c=a!=null?g(j(a)):{},l(b||!a||!a.__esModule?e(c,"default",{value:a,enumerable:!0}):c,a));export{m as a,n as b,o as c,p as d};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFtdLAogICJzb3VyY2VzQ29udGVudCI6IFtdLAogICJtYXBwaW5ncyI6ICIiLAogICJuYW1lcyI6IFtdCn0K