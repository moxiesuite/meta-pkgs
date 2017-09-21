module.exports = {
  parseTerm: function(term) {
    let match = term.match(/(.*)(@|:)(.*)/);
    return {
      pkg: match[1],
      selector: match[2],
      branch: match[3]
    };
  }
}
