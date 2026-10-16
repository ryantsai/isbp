import base from '@isbp/eslint-config/base';

// Runtime reports and local browser probes are already excluded from version control.
export default [...base, { ignores: ['.state/**'] }];
