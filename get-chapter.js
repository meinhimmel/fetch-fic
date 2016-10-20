'use strict'
module.exports = getChapter
var url = require('url')
var cheerio = require('cheerio')
var xenforoDateTime = require('./datetime.js')
var color = require('color-ops')

function getChapter (fetch, chapter, noCache) {
  return fetch(chapter, noCache).spread(function (finalURL, html) {
    var chapterHash = url.parse(chapter).hash
    var parsed = url.parse(finalURL)
    var id
    if (/^#post/.test(chapterHash)) {
      id = chapterHash || parsed.hash || ''
    } else {
      id = parsed.hash || chapterHash || ''
    }
    if (id) {
      parsed.hash = id
      finalURL = url.format(parsed)
    }
    var $ = cheerio.load(html)
    var $message
    if (id !== '') {
      $message = $('li.message#' + id.slice(1))
    } else {
      $message = $($('li.message')[0])
    }
    var $content = $message.find('article')
    if ($content.length === 0) {
      var $error = $('div.errorPanel')
      if ($error.length === 0) {
        if (noCache) {
          throw new Error('No chapter found at ' + chapter)
        } else {
          return getChapter(fetch, chapter, true)
        }
      } else {
        throw new Error('Error fetching ' + chapter + ': ' + $error.text().trim())
      }
    }
    $content.find('.quoteExpand').remove()
    var $spoiler = $content.find('.bbCodeSpoilerContainer')
    $spoiler.attr('style', 'border: solid black 1px')
    $spoiler.find('.bbCodeSpoilerButton').remove()
    var base = $('base').attr('href') || finalURL
    var $author = $($message.find('a.username')[0])
    var authorUrl = url.resolve(base, $author.attr('href'))
    var authorName = $author.text()
    var messageDate = xenforoDateTime($message.find('a.datePermalink .DateTime'))
    var baseLightness = 0
    if (/spacebattles/.test(chapter)) {
      baseLightness = color.lightness(color.rgb(204,204,204))
    }
    else if (/questionablequesting/.test(chapter)) {
      baseLightness = color.lightness(color.rgb(86,86,86))
    }
    else if (/sufficientvelocity/.test(chapter)) {
      baseLightness = color.lightness(color.rgb(230,230,230))
    }
    $content.find('[style *= color]').each(function (ii, vv) {
      var style = $(vv).attr('style')
      var ns = ''
      var colorMatch = style.match(/color: #(\S\S)(\S\S)(\S\S)/)
      var opacity = 1
      if (colorMatch) {
        var r = Number('0x' + colorMatch[1])
        var g = Number('0x' + colorMatch[2])
        var b = Number('0x' + colorMatch[3])
        var lightness = color.lightness(color.rgb(r, g, b))
        opacity = lightness / baseLightness
        if (baseLightness < 0.5) opacity = 1 - opacity
        if (opacity < 0.25) opacity = 0.25
        ns = 'opacity: ' +  opacity + ';'
      } else if (style === 'color: transparent') {
        opacity = 0.25
        ns = 'text-decoration: line-through; font-style: oblique; opacity: 0.25;'
      }
      if (opacity > 1) {
        ns += 'font-weight: bolder;'
      }
      if (style === 'color: #ffcc99') {
        ns += 'font-style: italic;'
      } else if (style === 'color: #99ffff') {
        ns += 'font-style: italic;'
      } else if (style === 'color: #9999ff') {
        ns += 'font-family: fantasy; font-style: italic;'
      } else if (style === 'color: #4d4dff') {
        ns += 'border-style: hidden dashed;'
      } else if (style === 'color: #b3b300') {
        ns += 'border-style: hidden double;'
      } else if (style === 'color: #b30000') {
        ns += 'border-style: hidden solid;'
      }
      $(vv).attr('style', ns)
    })
    return {
      chapterLink: chapter,
      finalURL: finalURL,
      base: base,
      author: authorName,
      authorUrl: authorUrl,
      created: messageDate,
      raw: html,
      content: $content.html()
        .replace(/^\s*<blockquote[^>]*>([\s\S]+)<[/]blockquote>\s*$/, '$1')
    }
  })
}
