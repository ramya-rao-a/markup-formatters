'use strict';

import parseFields from '@emmetio/field-parser';
import output from '../lib/output-builder';
import Format from '../lib/format';
import OutputNode from '../lib/output-node';
import { handlePseudoSnippet, isFirstChild, isRoot, isPseudoSnippet } from '../lib/utils';

/**
 * Outputs given parsed Emmet abbreviation as HTML, formatted according to
 * `profile` options
 * @param  {Node}     tree           Parsed Emmet abbreviation
 * @param  {Profile}  profile        Output profile
 * @param  {Function} [postProcess]  A post-processor for generated output node
 * that applies various transformations on it to shape-up a final output.
 * A post-processor is a function that takes `OutputNode` as first argument and
 * `Profile` as second and returns updated or new output node.
 * If it returns `null` – node will not be outputted
 * @return {String}
 */
export default function(tree, profile, field) {
	return output(tree, field, (node, level, renderFields, next) => {
		let outNode = new OutputNode(node, getFormat(node, level, profile));

		if (!handlePseudoSnippet(outNode, renderFields)) {
			if (node.name) {
				const name = profile.name(node.name);
				const attrs = formatAttributes(node, profile, renderFields);

				outNode.open = `<${name}${attrs}${node.selfClosing ? profile.selfClose() : ''}>`;
				if (!node.selfClosing) {
					outNode.close = `</${name}>`;
				}
			}

			// Do not generate fields for nodes with empty value and children
			// or if node is self-closed
            if (node.value || (!node.children.length && !node.selfClosing) ) {
                outNode.text = renderFields(node.value);
            }
		}

        return outNode.toString(next());
	});
}

/**
 * Returns formatter object for given abbreviation node
 * @param  {Node}    node    Parsed abbreviation node
 * @param  {Number}  level   Node’s depth level in its tree
 * @param  {Profile} profile Output profile
 * @return {Format}
 */
function getFormat(node, level, profile) {
    const format = new Format();

    if (shouldFormatNode(node, profile)) {
        format.indent = profile.indent(getIndentLevel(node, profile, level));
        format.newline = '\n';
        const prefix = format.newline + format.indent;

        // do not format the very first node in output
        if (!isRoot(node.parent) || !isFirstChild(node)) {
            format.beforeOpen = prefix;
            if (node.isTextOnly) {
                format.beforeText = prefix;
            }
        }

        if (hasInnerFormatting(node, profile)) {
            if (!node.isTextOnly) {
                format.beforeText = prefix + profile.indent(1);
            }
            format.beforeClose = prefix;
        }
    }

    return format;
}

/**
 * Check if given node should be formatted
 * @param  {Node} node
 * @param  {Profile} profile
 * @return {Boolean}
 */
function shouldFormatNode(node, profile) {
	if (!profile.get('format')) {
		return false;
	}

    if (node.parent.isTextOnly
        && node.parent.children.length === 1
        && parseFields(node.parent.value).fields.length) {
        // Edge case: do not format the only child of text-only node,
        // but only if parent contains fields
        return false;
    }

	return isInline(node, profile) ? shouldFormatInline(node, profile) : true;
}

/**
 * Check if given inline node should be formatted as well, e.g. it contains
 * enough adjacent siblings that should force formatting
 * @param  {Node} node
 * @param  {Profile} profile
 * @return {Boolean}
 */
function shouldFormatInline(node, profile) {
	if (!isInline(node, profile)) {
		return false;
	}

    if (isPseudoSnippet(node)) {
        return true;
    }

    // check if inline node is the next sibling of block-level node
    if (node.childIndex === 0) {
        // first node in parent: format if it’s followed by a block-level element
        let next = node;
        while (next = next.nextSibling) {
            if (!isInline(next, profile)) {
                return true;
            }
        }
    } else if (!isInline(node.previousSibling, profile)) {
        // node is right after block-level element
        return true;
    }

    if (profile.get('inlineBreak')) {
        // check for adjacent inline elements before and after current element
        let adjacentInline = 1;
        let before = node, after = node;

        while (isInlineElement((before = before.previousSibling), profile)) {
            adjacentInline++;
        }

        while (isInlineElement((after = after.nextSibling), profile)) {
            adjacentInline++;
        }

        return adjacentInline >= profile.get('inlineBreak');
    }

    return false;
}

/**
 * Check if given node contains inner formatting, e.g. any of its children should
 * be formatted
 * @param  {Node} node
 * @param  {Profile} profile
 * @return {Boolean}
 */
function hasInnerFormatting(node, profile) {
    // check if node if forced for inner formatting
    const nodeName = (node.name || '').toLowerCase();
    if (profile.get('formatForce').indexOf(nodeName) !== -1) {
        return true;
    }

    // check if any of children should receive formatting
    // NB don’t use `childrent.some()` to reduce memory allocations
    for (let i = 0; i < node.children.length; i++) {
        if (shouldFormatNode(node.children[i], profile)) {
            return true;
        }
    }

    return false;
}

/**
 * Outputs attributes of given abbreviation node as HTML attributes
 * @param  {Node} node
 * @param  {Profile} profile
 * @param  {Function} renderFields
 * @return {String}
 */
function formatAttributes(node, profile, renderFields) {
    return node.attributes.map(attr => {
        if (attr.options.implied && attr.value == null) {
    		return null;
    	}

    	const attrName = profile.attribute(attr.name);
    	let attrValue = null;

        // handle boolean attributes
    	if (attr.options.boolean || profile.get('booleanAttributes').indexOf(attrName.toLowerCase()) !== -1) {
    		if (profile.get('compactBooleanAttributes') && attr.value == null) {
    			return ` ${attrName}`;
    		} else if (attr.value == null) {
    			attrValue = attrName;
    		}
    	}

    	if (attrValue == null) {
    		attrValue = renderFields(attr.value);
    	}

    	return ` ${attrName}=${profile.quote(attrValue)}`;
    }).join('');
}

/**
 * Check if given node is inline-level
 * @param  {Node}  node
 * @param  {Profile}  profile
 * @return {Boolean}
 */
function isInline(node, profile) {
	return (node && node.isTextOnly) || isInlineElement(node, profile);
}

/**
 * Check if given node is inline-level element, e.g. element with explicitly
 * defined node name
 * @param  {Node}  node
 * @param  {Profile}  profile
 * @return {Boolean}
 */
function isInlineElement(node, profile) {
	return node && profile.isInline(node);
}

/**
 * Computes indent level for given node
 * @param  {Node} node
 * @param  {Profile} profile
 * @param  {Number} level
 * @return {Number}
 */
function getIndentLevel(node, profile, level) {
	level = level || 0;

	// decrease indent level if:
	// * parent node is a text-only node
	// * there’s a parent node with a name that is explicitly set to decrease level
	if (node.parent.isTextOnly) {
		level--;
	}

	let ctx = node;
	const skip = profile.get('formatSkip');
	while (ctx = ctx.parent) {
		if (skip.indexOf( (ctx.name || '').toLowerCase() ) !== -1) {
			level--;
		}
	}

	return level < 0 ? 0 : level;
}
