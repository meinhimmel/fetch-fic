'use strict'
const url = require('url')
const Site = use('site')
const cache = use('cache')
const moment = require('moment')
const tagmap = use('tagmap')('ao3')
const qr = require('@perl/qr')
const forEach = use('for-each')

class ArchiveOfOurOwn extends Site {
  static matches (siteUrlStr) {
    const siteUrl = url.parse(siteUrlStr)
    const hostname = siteUrl.hostname
    if (!qr`(^|www[.])archiveofourown.org$`.test(hostname)) return false
    const path = siteUrl.pathname || siteUrl.path || ''
    if (!qr`^(/collections/[^/]+)?(/works/\d+|/users/)`.test(path)) return false
    return true
  }

  constructor (siteUrlStr) {
    super(siteUrlStr)
    this.link = this.link.replace(qr`/works/(\d+).*?$`, '/works/$1')
    this.publisher = 'archiveofourown.org'
    this.publisherName = 'Archive of Our Own'
    this.type = 'ao3'
    this.shortName = 'ao3'
    const siteUrl = url.parse(siteUrlStr)
    const path = siteUrl.pathname || siteUrl.path || ''
    const ficMatch = path.match(qr`^/works/(\d+)`)
    this.workId = ficMatch && ficMatch[1]
  }

  normalizeLink (href, base) {
    if (!href) return
    return super.normalizeLink(href, base)
      .replace(/#.*$/, '')
      .replace(/[/]collections[/][^/]+[/]?/, '/')
  }
  normalizeFicLink (href, base) {
    return super.normalizeFicLink(href, base)
      .replace(/[/]chapters[/]\d+/, '')
  }
  normalizeAuthorLink (href, base) {
    return super.normalizeAuthorLink(href, base)
      .replace(qr`/pseuds/.*`, '/profile')
  }
  chapterIndex () {
    return 'https://archiveofourown.org/works/' + this.workId + '/navigate'
  }
  tagGroup ($, prefix, $dd) {
    const tags = []
    $dd.find('li').each((ii, vv) => {
      tags.push(prefix + ':' + $(vv).text().trim())
    })
    return tags
  }
  async getFicMetadata (fetch, fic) {
    fic.link = this.normalizeFicLink(this.link)
    fic.publisher = this.publisherName
    fic.chapterHeadings = true
    const [meta, html] = await fetch(this.chapterIndex())
    const cheerio = require('cheerio')
    const $ = cheerio.load(html)
    if ($('.error-503-maintenance').length) {
      const err = new Error($('#main').text().trim().split(/\n/).map(l => l.trim()).join('\n'))
      err.link = this.chapterIndex()
      err.code = 503
      err.site = this.publisherName
      await cache.clearUrl(err.link)
      throw err
    }
    if (html.length < 1500) {
      try {
        const j = JSON.parse(html)
        const err = new Error(j.meta.statusText)
        err.link = j.url
        err.code = j.code
        err.site = this.publisherName
        await cache.clearUrl(j.url)
        throw err
      } catch (_) {}
    }
    const base = $('base').attr('href') || this.chapterIndex()
    const $heading = $('h2.heading')
    fic.title = $heading.find('a[rel!="author"]').text()
    if (/\[archived by/.test($heading.text())) {
      $heading.find('a').remove()
      const author = $heading.text().trim().replace(/.*by (.*) \[archived by.*/, '$1').trim()
      fic.author = author
    } else {
      const $author = $heading.find('a[rel="author"]')
      const aus = []
      $author.each((ii, ac) => {
        const $ac = $(ac)
        const authorUrl = (this.normalizeChapterLink($ac.attr('href'), base) || '').replace(qr`/pseuds/.*`, '/profile')
        const authorName = $ac.text()
        fic.authors.push({name: authorName, link: authorUrl})
        if ((!fic.author && !fic.authorUrl) || ((!fic.author || !fic.authorUrl) && (authorUrl && authorName))) {
          fic.author = authorName
          fic.authorUrl = authorUrl
        }
      })
    }
    const $metadata = $('ol.index').find('li').first()
    const metadataLink = this.normalizeChapterLink($metadata.find('a').attr('href'), base)
    const Chapter = use('fic').Chapter
    const chapter = await new Chapter({link: metadataLink}).getContent(fetch)

    if (chapter.$('.error-503-maintenance').length) {
      const err = new Error(chapter.$('#main').text().trim().split(/\n/).map(l => l.trim()).join('\n'))
      err.link = chapter.fetchWith()
      err.code = 503
      err.site = this.publisherName
      await cache.clearUrl(err.link)
      throw err
    }
    const $meta = chapter.$('dl.meta')
    const ratings = this.tagGroup(chapter.$, 'rating', $meta.find('dd.rating'))
    const warnings = this.tagGroup(chapter.$, 'warning', $meta.find('dd.warnings'))
      .filter(warn => !/No Archive Warnings Apply/.test(warn))
    const category = this.tagGroup(chapter.$, 'category', $meta.find('dd.category'))
    const fandom = this.tagGroup(chapter.$, 'fandom', $meta.find('dd.fandom'))
      .map(r => r.replace(/ - Fandom$/, ''))
    const relationship = this.tagGroup(chapter.$, '', $meta.find('dd.relationship'))
      .filter(r => r !== ':Friendship - Relationship')
      .map(r => r.replace(/^:/, qr`/`.test(r) ? 'ship:' : 'friendship:'))
      .map(r => r.replace(qr.g`\s*(/)\s*`, '/'))
      .map(r => r.replace(qr.g`\s*([&])\s*`, ' & '))
      .map(r => r.replace(/ - Relationship$/, ''))
    const characters = this.tagGroup(chapter.$, 'character', $meta.find('dd.character'))
      .map(t => t.replace(/ - Character$/, ''))
    const freeform = this.tagGroup(chapter.$, 'freeform', $meta.find('dd.freeform'))
      .map(t => t.replace(/ - Freeform$/, ''))
    const language = 'language:' + $meta.find('dd.language').text().trim()
    fic.tags = [].concat(ratings, warnings, category, fandom, relationship, characters, freeform, language)
    const $stats = $meta.find('dl.stats')
    const chapterCounts = $stats.find('dd.chapters').text().trim().split('/')
    const written = chapterCounts[0]
    const planned = chapterCounts[1]
    if (written === planned) {
      if (written === '1') {
        fic.tags.push('status:one-shot')
      } else {
        fic.tags.push('status:complete')
      }
    }
    fic.tags = tagmap(fic.tags)
    fic.created = moment.utc($stats.find('dd.published').text().trim())
    const modified = $stats.find('dd.status').text().trim()
    fic.modified = modified && moment.utc(modified)
    fic.words = Number($stats.find('dd.words').text().trim())
    fic.comments = Number($stats.find('dd.comments').text().trim())
    fic.kudos = Number($stats.find('dd.kudos').text().trim())
    fic.bookmarks = Number($stats.find('dd.bookmarks').text().trim())
    fic.hits = Number($stats.find('dd.hits').text().trim())
    fic.title = chapter.$('h2.title').text().trim()
    fic.description = (chapter.$('.summary').find('.userstuff').html() || '').replace(/<p>/g, '\n<p>').replace(/^\s+|\s+$/g, '')
    const chapterList = $('ol.index').find('li')
    chapterList.each((ii, vv) => {
      const $vv = $(vv)
      const name = $vv.find('a').text().replace(/^\d+[.] /, '')
      const link = this.normalizeChapterLink($vv.find('a').attr('href'), base)
      const created = moment.utc($vv.find('span.datetime').text(), '(YYYY-MM-DD)')
      fic.addChapter({name, link, created})
    })
  }

  async getChapter (fetch, chapterInfo) {
    const [meta, html] = await fetch(chapterInfo.fetchWith())
    const ChapterContent = use('chapter-content')
    const chapter = new ChapterContent(chapterInfo, {html, site: this})
    if (chapter.$('.error-503-maintenance').length) {
      const err = new Error(chapter.$('#main').text().trim().split(/\n/).map(l => l.trim()).join('\n'))
      err.link = chapter.fetchWith()
      err.code = 503
      err.site = this.publisherName
      await cache.clearUrl(err.link)
      throw err
    }
    if (chapter.$('p.caution').length) {
      chapterInfo.fetchFrom = chapterInfo.fetchWith() + '?view_adult=true'
      return this.getChapter(fetch, chapterInfo)
    }
    chapter.base = chapter.$('base').attr('href') || meta.finalUrl
    if (meta.finalUrl !== chapter.link) {
      chapter.fetchFrom = chapter.link
      chapter.link = meta.finalUrl
    }
    const $content = chapter.$('div[role="article"]')
    $content.find('h3.landmark').remove()

    const notes = chapter.$('#notes').find('.userstuff').html()
    const endNotes = chapter.$('div.end').find('.userstuff').html()
    let content = ''
    if (notes && !/\(See the end of the chapter for.*notes.*.\)/.test(notes)) {
      content += `<aside style="border: solid black 1px; padding: 1em">${notes}</aside>`
    }
    content += $content.html()
    if (endNotes) content += `<aside epub:type="endnote" style="border: solid black 1px; padding: 1em">${endNotes}</aside>`
    chapter.content = content
    return chapter
  }
  async getUserInfo (fetch, externalName, link) {
    link = link.replace(qr`/pseuds/.*`, '/profile')
    const cheerio = require('cheerio')
    const authCookies = require(`${__dirname}/../.authors_cookies.json`)
    const [res, auhtml] = await fetch(link)
    const $ = cheerio.load(auhtml)
    const name = $('div.user div.header h2').text().trim() || externalName
    const location = $('dt.location ~ dd').first().text().trim() || undefined
    const image_src = $('img.icon').first().attr('src')
    const image = (image_src && !/xicon_user/.test(image_src)) ? url.resolve(link, image_src) : undefined

    const profile = $('div.bio blockquote.userstuff').html() || undefined
    return {name, link, location, image, profile}
  }
}

module.exports = ArchiveOfOurOwn
