
export function toCamelCase(inputString) {
  return inputString ? inputString.toLowerCase().replace(/(^\w{1})|(\s{1}\w{1})/g, match => match.toUpperCase()) : null;
}
