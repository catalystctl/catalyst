export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Allow subject case to be any (we use imperative lowercase by convention)
    'subject-case': [0],
    // Max subject length — generous for descriptive messages
    'subject-max-length': [2, 'always', 120],
    // Body max line length — allow longer for detailed descriptions
    'body-max-line-length': [0],
  },
};
