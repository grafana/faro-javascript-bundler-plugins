export default function faroPlugin() {
  return {
    name: "rollup-plugin-faro-sourcemap-uploader", // this name will show up in logs and errors
    async transform(code: string, id: string) {
      const newCode = `${code}
      (function (){
        var globalObj = (typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {});
        globalObj.FARO_BUILD_ID = "${id}";
        })();`;
      // @ts-ignore
      const newAst = this.parse(newCode);

      return {
        code: `${code}
      (function (){
        var globalObj = (typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {});
        globalObj.FARO_BUILD_ID = "${id}";
        })();`,
        map: null,
      };
    },
  };
}
