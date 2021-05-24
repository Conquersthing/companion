const plugin_base = require('./plugin_base')
const debug = require('debug')('lib/schedule/feedback')

/** Even though the plugin has said it will have multiple, the caller flattens the array and we need to fight that */
function ensure_array(v) {
	if (Array.isArray(v)) {
		return v
	} else if (v) {
		return [v]
	} else {
		return []
	}
}

/**
 * TODO
 * - hook into checkAllFeedbacks
 * - hook into upgrade-scripts
 * - implement config_desc
 * - tidying?
 * - does the plugin system make sense like this? I had to bypass many bits of it
 * - does the last_value logic make sense?
 */

class feedback extends plugin_base {
	setup() {
		this.scheduler.system.on('feedback_instance_check', this.check_feedbacks.bind(this))

		// hack: the ui has the behaviour hardcoded due to how different it is
		this.options = []
	}

	get multiple() {
		return true
	}

	/**
	 * Add event to watch for
	 * @param {number} id
	 * @param {Object} data
	 */
	add(id, data) {
		const data2 = {
			...data,
			last_values: {},
			last_value: false,
		}

		super.add(id, data2)

		for (const fb of ensure_array(data2.config)) {
			this.scheduler.system.emit('feedback_subscribe', fb)
		}

		this.check_entry(data2)
	}

	/**
	 * Remove event from watch list
	 * @param {number} id
	 */
	remove(id) {
		const feedback = this.watch.find((c) => c.id === id)
		if (feedback) {
			for (const fb of ensure_array(feedback.config)) {
				this.scheduler.system.emit('feedback_unsubscribe', fb)
			}
		}
		super.remove(id)
	}

	/**
	 * An instance has requested that its feedbacks are checked
	 */
	check_feedbacks(instance, type) {
		console.log('do check', instance.id, type)

		for (const entry of this.watch) {
			this.check_entry(entry, instance.id, type)
		}
	}

	check_entry(entry, changed_instance_id, change_feedback_type) {
		const feedbacks = ensure_array(entry.config)

		let entry_new_value = true // Start with true, as we do an and down the line
		if (feedbacks.length === 0) {
			// no feedbacks means always false
			entry_new_value = false
		}

		for (const feedback of feedbacks) {
			if (!entry_new_value) {
				// exit early once we hit a false
				break
			}

			let last_value = entry.last_values[feedback.id]

			if (last_value !== undefined) {
				// don't recheck this one if we have a value, and we've not been told to

				if (change_feedback_type !== undefined && feedback.type != change_feedback_type) {
					entry_new_value = entry_new_value && last_value
					continue
				}

				if (changed_instance_id !== undefined && feedback.instance_id != changed_instance_id) {
					entry_new_value = entry_new_value && last_value
					continue
				}
			}

			let instance
			this.scheduler.system.emit('instance_get', feedback.instance_id, (inst) => {
				instance = inst
			})

			let definition
			this.scheduler.system.emit('feedback_definition_get', feedback.instance_id, feedback.type, (def) => {
				definition = def
			})

			let new_value = false

			try {
				// Ask instance to check bank for custom styling
				if (definition !== undefined && typeof definition.callback == 'function') {
					new_value = definition.callback(feedback, null, null)
				} else if (instance !== undefined && typeof instance.feedback == 'function') {
					new_value = instance.feedback(feedback, null, null)
				} else {
					debug('ERROR: unable to check feedback "' + feedback.label + '"')
				}
			} catch (e) {
				this.scheduler.system.emit(
					'log',
					'feedback(' + feedback.label + ')',
					'warn',
					'Error checking feedback: ' + e.message
				)
				new_value = false
			}

			// We need to have a bool here
			if (typeof new_value !== 'boolean') new_value = false

			// update the result
			entry_new_value = entry_new_value && new_value
		}

		// check for a change
		if (entry.last_value != entry_new_value) {
			entry.last_value = entry_new_value

			// Run it when going to true
			if (entry_new_value) {
				this.scheduler.action(entry.id)
			}
		}
	}

	get type() {
		return 'feedback'
	}

	get name() {
		return 'Feedback'
	}

	_cond_desc(feedback) {
		// const instanceLabel = 'Not yet'
		// const feedbackSpec = (this.definitions[feedback.instance_id] || {})[feedback.type]
		// if (feedbackSpec) {
		// 	return `${instanceLabel}: ${feedbackSpec.label}`
		// } else {
		// 	return `${instanceLabel}: ${feedback.type} (undefined)`
		// }
	}

	config_desc(config) {
		let cond_list = []
		// if (Array.isArray(config)) {
		// 	config.forEach((x) => cond_list.push(this._cond_desc(x)))
		// } else {
		// 	cond_list.push(this._cond_desc(config))
		// }
		return `Runs on feedbacks <strong>${cond_list.join('</strong> AND <strong>')}</strong>.`
	}
}

module.exports = feedback
