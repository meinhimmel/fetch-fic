'use strict'
const qw = require('./qw.js')
const Site = require('./site.js')

class Fic {
  constructor (fetch) {
    this.fetch = fetch
    this.title = null
    this.link = null
    this.author = null
    this.authorUrl = null
    this.created = null
    this.modified = null
    this.publisher = null
    this.description = null
    this.site = null
    this.tags = []
    this.fics = []
    this.chapters = new ChapterList()
  }

  chapterExists (link) {
    if (this.chapters.chapterExists(link)) return true
    if (this.fics.some(fic => fic.chapterExists(link))) return true
    return false
  }

  getChapter (fetch, link) {
    return this.site.getChapter(fetch, link)
  }

  addChapter (name, link, created) {
    if (this.chapterExists(link)) return
    return this.chapters.addChapter(name, link, created)
  }

  importFromJSON (raw) {
    for (let prop of qw`link title author authorUrl created modified description tags publisher`) {
      this[prop] = raw[prop]
    }
    this.chapters.importFromJSON(raw)
    if (raw.fics) {
      raw.fics.forEach(fic => this.fics.push(SubFic.fromJSON(this, fic)))
    }
    this.site = Site.fromUrl(this.link)
    return this
  }

  static fromUrl (fetch, link) {
    var fic = new this(fetch)
    fic.site = Site.fromUrl(link)
    fic.link = fic.site.link
    return fic.site.getFicMetadata(fetch, fic).then(thenMaybeFallback, thenMaybeFallback).thenReturn(fic)
    function thenMaybeFallback (err) {
      if (err && (!err.meta || err.meta.status !== 404)) throw err
      // no chapters in the threadmarks, fallback to fetching
      if (fic.chapters.length === 0) {
        return fic.site.scrapeFicMetadata(fetch, fic)
      }
    }
  }

  static fromUrlAndScrape (fetch, link) {
    var fic = new this(fetch)
    fic.site = Site.fromUrl(link)
    fic.link = fic.site.link
    return fic.site.getFicMetadata(fetch, fic).then(() => {
      return fic.site.scrapeFicMetadata(fetch, fic).thenReturn(fic)
    })
  }

  static scrapeFromUrl (fetch, link) {
    var fic = new this()
    fic.site = Site.fromUrl(link)
    fic.link = fic.site.link
    return fic.site.scrapeFicMetadata(fetch, fic).thenReturn(fic)
  }

  static fromJSON (raw) {
    const fic = new this()
    return fic.importFromJSON(raw)
  }

  toJSON () {
    var result = {}
    for (let prop of qw`title link author authorUrl created modified publisher description tags fics chapters`) {
      if (this[prop] != null && (!Array.isArray(this[prop]) || this[prop].length)) result[prop] = this[prop]
    }
    return result
  }
}

class SubFic extends Fic {
  constructor (parentFic) {
    super()
    delete this.fics
    this.parent = parentFic
  }
  chapterExists (link) {
    return this.chapters.chapterExists(link)
  }
  static fromJSON (parent, raw) {
    const fic = new this(parent)
    fic.importFromJSON(raw)
    return fic
  }
  get author () {
    return this._author || this.parent.author
  }
  set author (value) {
    return this._author = value
  }
  get authorUrl () {
    return this._authorUrl || this.parent.authorUrl
  }
  set authorUrl (value) {
    return this._authorUrl = value
  }
  get publisher () {
    return this._publisher || this.parent.publisher
  }
  set publisher (value) {
    return this._publisher = value
  }
  toJSON () {
    var result = {}
    for (let prop of qw`title link _author _authorUrl created modified _publisher description tags chapters`) {
      var assignTo = prop[0] === '_' ? prop.slice(1) : prop
      if (this[prop] && (this[prop].length == null || this[prop].length)) result[assignTo] = this[prop]
    }
    return result
  }
}

class ChapterList extends Array {
  chapterExists (link) {
    return this.some(chap => chap.link === link)
  }
  addChapter (baseName, link, created) {
    if (this.chapterExists(link)) return
    let name = baseName
    let ctr = 0
    while (this.some(chap => chap.name === name)) {
      name = baseName + ' (' + ++ctr + ')'
    }
    if (created && !this.created) this.created = created
    const chapter = new Chapter({order: this.length, name, link, created})
    this.push(chapter)
    return chapter
  }
  importFromJSON (raw) {
    raw.chapters.forEach(chapter => this.push(Chapter.fromJSON(this.length, chapter)))
  }
}

class Chapter {
  constructor (opts) {
    this.order = opts.order
    this.name = opts.name
    this.link = opts.link
    this.created = opts.created
    this.modified = opts.modified
    this.author = opts.author
    this.tags = opts.tags
  }
  toJSON () {
    return {
      name: this.name,
      link: this.link,
      author: this.author,
      created: this.created,
      modified: this.modified,
      tags: this.tags
    }
  }
  static fromJSON (order, opts) {
    return new Chapter(Object.assign({order}, opts))
  }
}

module.exports = Fic
