/* eslint-env browser */

import { PerkWorkflowBase } from './perk-workflow-base.js';
import axios from './axios.js';

export class PerkWorkflow extends PerkWorkflowBase {
    constructor(options) {
        super(Object.assign({ axios }, options));
    }
}